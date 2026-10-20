import { describe, expect, it } from 'vitest';
import { api, createHarness, jsonOf, sampleInterview } from './helpers/app';

async function published(h: ReturnType<typeof createHarness>) {
  const res = await api(h, 'POST', '/api/interviews', sampleInterview());
  const { interview } = await jsonOf(res);
  const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
  return { interview: (await jsonOf(pub)).interview };
}

async function submit(h: ReturnType<typeof createHarness>, publicId: string, answers: any[], participant = { name: 'Ann', email: 'ann@example.com' }) {
  const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
    method: 'POST',
    body: JSON.stringify({ participant, answers }),
  });
  expect(res.status).toBe(201);
  return jsonOf(res);
}

describe('dashboard + submissions + versioning integrity', () => {
  it('dashboard summary counts and recent lists reference real values', async () => {
    const h = createHarness();
    const { interview } = await published(h);
    await submit(h, interview.publicId, [{ questionUid: 'q_main', optionUids: ['o_web'] }]);
    const res = await api(h, 'GET', '/api/dashboard/summary');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.counts.activeInterviews).toBe(1);
    expect(body.counts.draftInterviews).toBe(0);
    expect(body.counts.totalSubmissions).toBe(1);
    expect(body.recentlyCreatedInterviews[0].interviewId).toBe('001');
    expect(body.recentSubmissions[0].submissionId).toMatch(/^sub_/);
    expect(body.recentSubmissions[0].interviewId).toBe(interview.id);
  });

  it('recent submissions paginate with stable ordering', async () => {
    const h = createHarness();
    const { interview } = await published(h);
    for (let i = 0; i < 5; i++) {
      await submit(h, interview.publicId, [{ questionUid: 'q_main', optionUids: ['o_web'] }], {
        name: `P${i}`, email: `p${i}@example.com`,
      });
    }
    const p1 = await jsonOf(await api(h, 'GET', '/api/submissions/recent?page=1&perPage=2'));
    const p2 = await jsonOf(await api(h, 'GET', '/api/submissions/recent?page=2&perPage=2'));
    expect(p1.submissions).toHaveLength(2);
    expect(p2.submissions).toHaveLength(2);
    expect(p1.total).toBe(5);
    const ids = new Set([...p1.submissions, ...p2.submissions].map((s: any) => s.submissionId));
    expect(ids.size).toBe(4);
    // out-of-range page -> empty list, still 200
    const p9 = await jsonOf(await api(h, 'GET', '/api/submissions/recent?page=9&perPage=2'));
    expect(p9.submissions).toHaveLength(0);
    // invalid perPage -> 400
    const bad = await api(h, 'GET', '/api/submissions/recent?perPage=9999');
    expect(bad.status).toBe(400);
  });

  it('per-version submission listing only includes that version', async () => {
    const h = createHarness();
    const { interview } = await published(h);
    await submit(h, interview.publicId, [{ questionUid: 'q_main', optionUids: ['o_web'] }]);
    // Create v2 by editing the published v1.
    const edit = await api(h, 'PUT', `/api/interviews/${interview.id}`, sampleInterview({ title: 'v2' }));
    const v2 = (await jsonOf(edit)).interview;
    const pub2 = await api(h, 'POST', `/api/interviews/${v2.id}/publish`);
    const v2pub = (await jsonOf(pub2)).interview;
    await submit(h, v2pub.publicId, [{ questionUid: 'q_main', optionUids: ['o_graphic'] }]);

    const s1 = await jsonOf(await api(h, 'GET', `/api/interviews/${interview.id}/submissions`));
    const s2 = await jsonOf(await api(h, 'GET', `/api/interviews/${v2.id}/submissions`));
    expect(s1.total).toBe(1);
    expect(s2.total).toBe(1);
    expect(s1.submissions[0].submissionId).not.toBe(s2.submissions[0].submissionId);
  });

  it('single submission detail reconstructs full question text + readable answers from its own version', async () => {
    const h = createHarness();
    const { interview } = await published(h);
    const sub = await submit(h, interview.publicId, [
      { questionUid: 'q_main', optionUids: ['o_web'] },
      { questionUid: 'q_web_followup', optionUids: ['o_ux', 'o_other'], otherText: 'Motion design' },
      { questionUid: 'q_comments', text: 'Great tool!' },
    ]);
    const res = await api(h, 'GET', `/api/submissions/${sub.submissionId}`);
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.submission.participantName).toBe('Ann');
    expect(body.answers.map((a: any) => a.questionText)).toEqual([
      'Which field do you prefer?',
      'Which web topics matter to you?',
      'What kind of graphic work?',
      'Any additional comments?',
    ]);
    const q1 = body.answers[0];
    expect(q1.mapping).toBe('1:a');
    expect(q1.readable).toBe('Web design');
    const q2 = body.answers[1];
    expect(q2.mapping).toBe('2:a,c');
    expect(q2.readable).toContain('UX');
    expect(q2.readable).toContain('(other: Motion design)');
    // Skipped applicable-but-unanswered optional question -> blank.
    expect(body.answers[2].readable).toBe('');
    // answerDisplay=mapping question shows mapping as displayed value.
    expect(body.answers[3].answerDisplay).toBe('mapping');
    expect(body.answers[3].displayed).toBe('Great tool!'); // text answers keep raw text
  });

  it('historical integrity: old submission keeps OLD option labels after version change', async () => {
    const h = createHarness();
    const { interview } = await published(h);
    const sub = await submit(h, interview.publicId, [{ questionUid: 'q_main', optionUids: ['o_web'] }]);

    // v2 flips meaning: code/option "a" now means Graphic design.
    const modified = sampleInterview({
      title: 'Design Study v2',
      questions: [
        {
          uid: 'q_main', type: 'single_choice', text: 'Which field do you prefer?', required: true,
          pageNumber: 1, displayOrder: 1,
          options: [
            { uid: 'o_web', label: 'Graphic design', code: 'a', displayOrder: 1 },
            { uid: 'o_graphic', label: 'Web design', code: 'b', displayOrder: 2 },
          ],
        },
      ],
      branchingRules: [],
    });
    const edit = await api(h, 'PUT', `/api/interviews/${interview.id}`, modified);
    const v2 = (await jsonOf(edit)).interview;
    const pub2 = await api(h, 'POST', `/api/interviews/${v2.id}/publish`);
    const v2pub = (await jsonOf(pub2)).interview;
    const sub2 = await submit(h, v2pub.publicId, [{ questionUid: 'q_main', optionUids: ['o_web'] }]);

    const d1 = await jsonOf(await api(h, 'GET', `/api/submissions/${sub.submissionId}`));
    const d2 = await jsonOf(await api(h, 'GET', `/api/submissions/${sub2.submissionId}`));
    // Same uid/code, different historical meaning.
    expect(d1.answers[0].readable).toBe('Web design');
    expect(d2.answers[0].readable).toBe('Graphic design');
    // Each submission belongs to exactly one version.
    expect(d1.submission.interviewId).toBe(interview.id);
    expect(d2.submission.interviewId).toBe(v2.id);
    expect(d1.submission.interviewDisplayId).toBe('001');
    expect(d2.submission.interviewDisplayId).toBe('002');
  });

  it('submission detail requires auth and rejects unknown ids safely', async () => {
    const h = createHarness();
    const anon = await h.request('/api/submissions/sub_whatever123456');
    expect(anon.status).toBe(401);
    const res = await api(h, 'GET', '/api/submissions/sub_whatever123456');
    expect(res.status).toBe(404);
    const body = JSON.stringify(await jsonOf(res));
    expect(body).not.toContain('stack');
    expect(body).not.toContain('SELECT');
  });
});
