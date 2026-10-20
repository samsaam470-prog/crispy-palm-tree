import { describe, expect, it } from 'vitest';
import { api, createHarness, jsonOf, sampleInterview } from './helpers/app';

async function createAndAuth(h: ReturnType<typeof createHarness>) {
  const res = await api(h, 'POST', '/api/interviews', sampleInterview());
  expect(res.status).toBe(201);
  return jsonOf(res);
}

describe('interview management', () => {
  it('creates a draft with sequential internal id and no public id', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    expect(interview.id).toBe(1);
    expect(interview.interviewId).toBe('001');
    expect(interview.status).toBe('draft');
    expect(interview.publicId).toBeNull();
    expect(interview.questions).toHaveLength(4);
    expect(interview.questions[0].options).toHaveLength(2);
    expect(interview.branchingRules).toHaveLength(2);
  });

  it('lists interviews newest-first', async () => {
    const h = createHarness();
    await createAndAuth(h);
    const second = await createAndAuth(h);
    const res = await api(h, 'GET', '/api/interviews');
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.interviews[0].id).toBe(second.interview.id);
    expect(body.interviews).toHaveLength(2);
  });

  it('gets one interview by display id ("001") and numeric id', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    const r1 = await api(h, 'GET', `/api/interviews/001`);
    expect(r1.status).toBe(200);
    expect((await jsonOf(r1)).interview.id).toBe(interview.id);
    const r2 = await api(h, 'GET', `/api/interviews/${interview.id}`);
    expect(r2.status).toBe(200);
  });

  it('rejects invalid ids with 400 and unknown ids with 404', async () => {
    const h = createHarness();
    const bad = await api(h, 'GET', '/api/interviews/abc');
    expect(bad.status).toBe(400);
    const missing = await api(h, 'GET', '/api/interviews/999');
    expect(missing.status).toBe(404);
  });

  it('updates a draft in place (same id)', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    const updated = sampleInterview({ title: 'Renamed Study' });
    const res = await api(h, 'PUT', `/api/interviews/${interview.id}`, updated);
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.mode).toBe('updated-draft');
    expect(body.interview.id).toBe(interview.id);
    expect(body.interview.title).toBe('Renamed Study');
  });

  it('editing a published version creates a NEW version and preserves the old one', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
    expect(pub.status).toBe(200);
    const pubBody = await jsonOf(pub);
    const publicIdV1 = pubBody.interview.publicId;

    // Change option A meaning to "Graphic design" in v2.
    const modified = sampleInterview({
      title: 'Design Preferences Study v2',
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
    expect(edit.status).toBe(201);
    const editBody = await jsonOf(edit);
    expect(editBody.mode).toBe('created-new-version');
    const v2 = editBody.interview;
    expect(v2.id).not.toBe(interview.id);
    expect(v2.parentInterviewId).toBe(interview.id);
    expect(v2.status).toBe('draft');

    // v1 untouched: same definition, same public link.
    const v1again = await api(h, 'GET', `/api/interviews/${interview.id}`);
    const v1body = (await jsonOf(v1again)).interview;
    expect(v1body.publicId).toBe(publicIdV1);
    expect(v1body.questions[0].options[0].label).toBe('Web design');
    expect(v1body.status).toBe('published');
  });

  it('duplicates into a new draft without copying submissions or public id', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
    const pid = (await jsonOf(pub)).interview.publicId;
    // Submit once so there IS historical data.
    const sub = await h.request(`/api/public/interviews/${pid}/submissions`, {
      method: 'POST',
      body: JSON.stringify({
        participant: { name: 'Ann', email: 'ann@example.com' },
        answers: [{ questionUid: 'q_main', optionUids: ['o_web'] }],
      }),
    });
    expect(sub.status).toBe(201);

    const dup = await api(h, 'POST', `/api/interviews/${interview.id}/duplicate`, { title: 'Copy Study' });
    expect(dup.status).toBe(201);
    const d = (await jsonOf(dup)).interview;
    expect(d.status).toBe('draft');
    expect(d.publicId).toBeNull();
    expect(d.title).toBe('Copy Study');
    expect(d.questions.map((q: any) => q.uid)).toEqual(['q_main', 'q_web_followup', 'q_graphic_followup', 'q_comments']);
    expect(d.branchingRules).toHaveLength(2);
    // Original still has exactly 1 submission; copy has none.
    const origSubs = await api(h, 'GET', `/api/interviews/${interview.id}/submissions`);
    expect((await jsonOf(origSubs)).total).toBe(1);
    const dupSubs = await api(h, 'GET', `/api/interviews/${d.id}/submissions`);
    expect((await jsonOf(dupSubs)).total).toBe(0);
  });

  it('validates input: page limit, choice options, branch refs, lengths', async () => {
    const h = createHarness();
    // 4 questions on one page
    const tooMany = sampleInterview({
      questions: [1, 2, 3, 4].map((n) => ({
        uid: `q${n}`, type: 'short_text', text: `Q${n}`, pageNumber: 1, displayOrder: n,
      })),
      branchingRules: [],
    });
    const r1 = await api(h, 'POST', '/api/interviews', tooMany);
    expect(r1.status).toBe(400);
    expect((await jsonOf(r1)).error.message).toMatch(/maximum is 3 per page/i);

    // single_choice without options
    const noOpts = sampleInterview({
      questions: [{ uid: 'q1', type: 'single_choice', text: 'x', pageNumber: 1 }],
      branchingRules: [],
    });
    const r2 = await api(h, 'POST', '/api/interviews', noOpts);
    expect(r2.status).toBe(400);

    // branch rule referencing unknown group
    const badRule = sampleInterview({
      branchingRules: [{ questionUid: 'q_main', optionUid: 'o_web', targetGroup: 'nope' }],
    });
    const r3 = await api(h, 'POST', '/api/interviews', badRule);
    expect(r3.status).toBe(400);
    expect((await jsonOf(r3)).error.message).toMatch(/unknown group/i);

    // overlong title
    const longTitle = sampleInterview({ title: 'x'.repeat(600) });
    const r4 = await api(h, 'POST', '/api/interviews', longTitle);
    expect(r4.status).toBe(400);
  });

  it('state transitions are enforced', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    // deactivate a draft -> 409
    const badDeact = await api(h, 'POST', `/api/interviews/${interview.id}/deactivate`);
    expect(badDeact.status).toBe(409);
    // publish, then publish again -> 409
    await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
    const rePub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
    expect(rePub.status).toBe(409);
    // deactivate -> inactive; activate -> published with SAME public id
    const deact = await api(h, 'POST', `/api/interviews/${interview.id}/deactivate`);
    expect(deact.status).toBe(200);
    const act = await api(h, 'POST', `/api/interviews/${interview.id}/activate`);
    const body = await jsonOf(act);
    expect(body.interview.status).toBe('published');
    expect(body.interview.publicId).toBeTruthy();
    const first = await api(h, 'GET', `/api/interviews/${interview.id}`);
    expect((await jsonOf(first)).interview.publicId).toBe(body.interview.publicId);
  });

  it('does not publish an interview whose pages exceed limits after raw DB edits', async () => {
    const h = createHarness();
    const { interview } = await createAndAuth(h);
    // Corrupt via direct SQL: add a 4th question on page 1.
    const ts = new Date().toISOString();
    for (let i = 2; i <= 4; i++) {
      h.sqlite
        .prepare(`UPDATE questions SET page_number = 1 WHERE interview_id = ? AND uid = ?`)
        .run(interview.id, ['q_main', 'q_web_followup', 'q_graphic_followup', 'q_comments'][i - 1]);
    }
    void ts;
    const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
    expect(pub.status).toBe(400);
    expect((await jsonOf(pub)).error.message).toMatch(/page 1 has 4 questions/i);
  });

  it('rejects requests without auth (401) even with valid bodies', async () => {
    const h = createHarness();
    const res = await h.request('/api/interviews', {
      method: 'POST',
      body: JSON.stringify(sampleInterview()),
    });
    expect(res.status).toBe(401);
  });
});
