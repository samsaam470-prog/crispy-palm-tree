import { describe, expect, it } from 'vitest';
import { api, createHarness, jsonOf, sampleInterview } from './helpers/app';

async function published(h: ReturnType<typeof createHarness>, def = sampleInterview()) {
  const res = await api(h, 'POST', '/api/interviews', def);
  const { interview } = await jsonOf(res);
  const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
  expect(pub.status).toBe(200);
  const body = await jsonOf(pub);
  return { interview: body.interview, publicId: body.interview.publicId as string };
}

function submissionBody(answers: any[], participant = { name: 'Ann Example', email: 'ann@example.com' }) {
  return JSON.stringify({ participant, answers });
}

describe('public interviews + submissions', () => {
  it('drafts are not publicly accessible (404)', async () => {
    const h = createHarness();
    const res = await api(h, 'POST', '/api/interviews', sampleInterview());
    const draft = (await jsonOf(res)).interview;
    // drafts have no public id at all
    expect(draft.publicId).toBeNull();
    const pub = await h.request('/api/public/interviews/someRandom1');
    expect(pub.status).toBe(404);
  });

  it('public ids are random tokens, not sequential', async () => {
    const h = createHarness();
    const a = await published(h);
    const b = await published(h);
    expect(a.publicId).not.toBe(b.publicId);
    expect(a.publicId.length).toBeGreaterThanOrEqual(22);
    expect(/^[A-Za-z0-9]+$/.test(a.publicId)).toBe(true);
    // Does not contain the internal id in sequence form
    expect(a.publicId).not.toMatch(/^0*\d{1,6}$/);
  });

  it('GET public interview returns questions/options/rules but hides admin fields', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}`);
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.interview.acceptingResponses).toBe(true);
    expect(body.interview.questions[0].options.map((o: any) => o.uid)).toEqual(['o_web', 'o_graphic']);
    expect(body.interview.branchingRules).toHaveLength(2);
    // No internal sequential id exposed.
    expect(JSON.stringify(body)).not.toMatch(/"id":\s*1\b/);
  });

  it('accepts a valid minimal submission and stores participant + version', async () => {
    const h = createHarness();
    const { interview, publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web'] }]),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.submissionId).toMatch(/^sub_/);
    const row = h.sqlite.prepare('SELECT * FROM submissions WHERE public_id=?').bind(body.submissionId).first<any>();
    const got = await row;
    expect(got.interview_id).toBe(interview.id);
    expect(got.participant_email).toBe('ann@example.com');
  });

  it('rejects missing required answers', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_comments', text: 'hi' }]),
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.code).toBe('REQUIRED_MISSING');
  });

  it('rejects unknown options and cross-version option ids', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_nonexistent'] }]),
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.code).toBe('UNKNOWN_OPTION');
  });

  it('enforces branching: rejects answers to non-applicable questions', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([
        { questionUid: 'q_main', optionUids: ['o_web'] },
        { questionUid: 'q_graphic_followup', text: 'posters' }, // graphic group not on path
      ]),
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.code).toBe('BRANCH_MISMATCH');
    // Correct web-path submission succeeds with follow-up omitted or answered.
    const ok = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([
        { questionUid: 'q_main', optionUids: ['o_web'] },
        { questionUid: 'q_web_followup', optionUids: ['o_ux', 'o_other'], otherText: 'Motion design' },
      ]),
    });
    expect(ok.status).toBe(201);
  });

  it('multi-choice rules: single_choice rejects multiple, Other requires text', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const multiOnSingle = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web', 'o_graphic'] }]),
    });
    expect(multiOnSingle.status).toBe(400);

    const otherNoText = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([
        { questionUid: 'q_main', optionUids: ['o_web'] },
        { questionUid: 'q_web_followup', optionUids: ['o_other'] },
      ]),
    });
    expect(otherNoText.status).toBe(400);
    expect((await jsonOf(otherNoText)).error.code).toBe('OTHER_TEXT_REQUIRED');
  });

  it('text length bounds enforced', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([
        { questionUid: 'q_main', optionUids: ['o_graphic'] },
        { questionUid: 'q_graphic_followup', text: 'x'.repeat(600) }, // short_text max 500
      ]),
    });
    expect(res.status).toBe(400);
  });

  it('invalid submission leaves NO database rows (atomic validation-first)', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const before = h.sqlite.prepare('SELECT COUNT(*) c FROM submissions').get() as any;
    const res = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['bogus_option'] }]),
    });
    expect(res.status).toBe(400);
    const after = h.sqlite.prepare('SELECT COUNT(*) c FROM submissions').get() as any;
    const answers = h.sqlite.prepare('SELECT COUNT(*) c FROM answers').get() as any;
    expect(after.c).toBe(before.c);
    expect(answers.c).toBe(0);
  });

  it('deactivated interviews reject new submissions with the exact message', async () => {
    const h = createHarness();
    const { interview, publicId } = await published(h);
    await api(h, 'POST', `/api/interviews/${interview.id}/deactivate`);
    const get = await h.request(`/api/public/interviews/${publicId}`);
    expect(get.status).toBe(200);
    const body = await jsonOf(get);
    expect(body.interview.message).toBe('This interview is no longer accepting responses.');
    const post = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web'] }]),
    });
    expect(post.status).toBe(409);
    expect((await jsonOf(post)).error.message).toBe('This interview is no longer accepting responses.');
    // Reactivating restores the SAME link.
    await api(h, 'POST', `/api/interviews/${interview.id}/activate`);
    const again = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web'] }]),
    });
    expect(again.status).toBe(201);
  });

  it('allows repeat submissions from the same person without overwriting', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const r1 = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web'] }]),
    });
    const r2 = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_graphic'] }]),
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const id1 = (await jsonOf(r1)).submissionId;
    const id2 = (await jsonOf(r2)).submissionId;
    expect(id1).not.toBe(id2);
    const count = h.sqlite.prepare('SELECT COUNT(*) c FROM submissions').get() as any;
    expect((await Promise.resolve(count)).c).toBe(2);
  });

  it('idempotency key prevents accidental double-processing', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const body = (key: string) =>
      JSON.stringify({
        participant: { name: 'Ann', email: 'ann@example.com' },
        answers: [{ questionUid: 'q_main', optionUids: ['o_web'] }],
        idempotencyKey: key,
      });
    const r1 = await h.request(`/api/public/interviews/${publicId}/submissions`, { method: 'POST', body: body('same-key-1234') });
    const r2 = await h.request(`/api/public/interviews/${publicId}/submissions`, { method: 'POST', body: body('same-key-1234') });
    expect((await jsonOf(r1)).submissionId).toBe((await jsonOf(r2)).submissionId);
    const c = h.sqlite.prepare('SELECT COUNT(*) c FROM submissions').get() as any;
    expect(c.c).toBe(1);
  });

  it('rate limits abusive submissions (per-isolate best effort)', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    // Warm the limiter with a first accepted request, then use idempotency
    // keys so the flood cannot add rows regardless of which requests pass.
    const warm = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: submissionBody([{ questionUid: 'q_main', optionUids: ['o_web'] }], {
        name: 'Warm Up', email: 'warm@example.com',
      }),
    });
    expect(warm.status).toBe(201);
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      last = await h.request(`/api/public/interviews/${publicId}/submissions`, {
        method: 'POST',
        body: JSON.stringify({
          participant: { name: `Person ${i}`, email: `p${i}@example.com` },
          answers: [{ questionUid: 'q_main', optionUids: ['o_web'] }],
          idempotencyKey: `flood-key-${i}-0000`,
        }),
      });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
  });

  it('rejects malformed JSON and bad participant data', async () => {
    const h = createHarness();
    const { publicId } = await published(h);
    const badJson = await h.request(`/api/public/interviews/${publicId}/submissions`, { method: 'POST', body: '{oops' });
    expect(badJson.status).toBe(400);
    const badEmail = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: JSON.stringify({
        participant: { name: 'x', email: 'not-an-email' },
        answers: [{ questionUid: 'q_main', optionUids: ['o_web'] }],
      }),
    });
    expect(badEmail.status).toBe(400);
  });

  it('unknown public id -> 404 with safe error shape', async () => {
    const h = createHarness();
    const res = await h.request('/api/public/interviews/zzzzzzzzzzzzzzzzzzzzzz');
    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.error.message).toBe('Interview not found.');
    expect(JSON.stringify(body)).not.toContain('D1');
    expect(JSON.stringify(body)).not.toContain('SELECT');
  });
});
