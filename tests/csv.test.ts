import { describe, expect, it } from 'vitest';
import { api, createHarness, jsonOf, sampleInterview } from './helpers/app';
import { buildCsv, escapeCsvField, sanitizeCsvValue } from '../src/utils/csv';

async function publishedWithSubmissions(h: ReturnType<typeof createHarness>) {
  const res = await api(h, 'POST', '/api/interviews', sampleInterview());
  const { interview } = await jsonOf(res);
  const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
  const body = await jsonOf(pub);
  const publicId = body.interview.publicId as string;
  const submit = async (answers: any[], participant: any) => {
    const r = await h.request(`/api/public/interviews/${publicId}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ participant, answers }),
    });
    expect(r.status).toBe(201);
    return jsonOf(r);
  };
  return { interview: body.interview, publicId, submit };
}

describe('csv unit tests', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(sanitizeCsvValue('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(sanitizeCsvValue('@cmd|x')).toBe("'@cmd|x");
    expect(sanitizeCsvValue('+1')).toBe("'+1");
    expect(sanitizeCsvValue('-1')).toBe("'-1");
    // negative numbers in normal text not at start stay untouched
    expect(sanitizeCsvValue('temperature -5')).toBe('temperature -5');
  });

  it('buildCsv joins with CRLF and trailing newline', () => {
    const csv = buildCsv(['A', 'B'], [['1', 'x,y']]);
    expect(csv).toBe('A,B\r\n1,"x,y"\r\n');
  });
});

describe('csv export endpoint', () => {
  it('exports neutral headers Q1..Qn, correct columns, both modes', async () => {
    const h = createHarness();
    const { interview, publicId, submit } = await publishedWithSubmissions(h);
    await submit(
      [
        { questionUid: 'q_main', optionUids: ['o_web'] },
        { questionUid: 'q_web_followup', optionUids: ['o_ux', 'o_other'], otherText: 'Motion, design' },
        { questionUid: 'q_comments', text: '=HYPERLINK("http://evil","click")' },
      ],
      { name: 'Ann, Jr.', email: 'ann@example.com' },
    );

    const readable = await api(h, 'GET', `/api/interviews/${interview.id}/submissions/export?mode=readable`);
    expect(readable.status).toBe(200);
    expect(readable.headers.get('Content-Type')).toContain('text/csv');
    expect(readable.headers.get('Content-Disposition')).toContain('attachment');
    const text = await readable.text();
    const lines = text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('Submission ID,Interview ID,Participant Name,Participant Email,Submitted At,Q1,Q2,Q3,Q4');
    const row = lines[1];
    expect(row).toContain('"Ann, Jr."');            // comma escaped + quoted
    expect(row).toContain('Web design');            // readable label
    expect(row).toContain('"UX; Other (other: Motion, design)"'); // multi + other w/ comma
    // Formula-injected text answer must be quote-prefixed and fully escaped.
    expect(row).toContain(`"'=HYPERLINK""(http://evil"",""click"")"""`);
    // Question text must NOT appear as a header.
    expect(lines[0]).not.toContain('Which field');

    const mapping = await api(h, 'GET', `/api/interviews/${interview.id}/submissions/export?mode=mapping`);
    const mtext = (await mapping.text()).replace(/^\uFEFF/, '');
    expect(mtext).toContain('1:a');
    expect(mtext).toContain('2:a,c');
  });

  it('invalid mode -> 400; unknown interview -> 404; requires auth', async () => {
    const h = createHarness();
    const anon = await h.request('/api/interviews/1/submissions/export');
    expect(anon.status).toBe(401);
    const badMode = await api(h, 'GET', '/api/interviews/1/submissions/export?mode=pwn');
    expect(badMode.status).toBe(400);
    const missing = await api(h, 'GET', '/api/interviews/777/submissions/export');
    expect(missing.status).toBe(404);
  });

  it('blank optional answers export as empty cells', async () => {
    const h = createHarness();
    const { interview, publicId, submit } = await publishedWithSubmissions(h);
    const s = await submit([{ questionUid: 'q_main', optionUids: ['o_graphic'] }], {
      name: 'Zoe', email: 'zoe@example.com',
    });
    const res = await api(h, 'GET', `/api/interviews/${interview.id}/submissions/export`);
    const text = (await res.text()).replace(/^\uFEFF/, '');
    const lines = text.split('\r\n');
    const cols = lines[1].split(',');
    // Q2 (web follow-up, hidden by branch), Q3 (graphic follow-up, skipped),
    // Q4 comments — all blank.
    expect(cols[cols.length - 1]).toBe('');
    expect(text).toContain(s.submissionId);
  });
});
