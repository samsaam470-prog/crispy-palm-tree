import { it } from 'vitest';
import { api, createHarness, jsonOf, sampleInterview } from '../helpers/app';
it('debug direct query', async () => {
  const h = createHarness();
  const res = await api(h, 'POST', '/api/interviews', sampleInterview());
  const interview = (await jsonOf(res)).interview;
  const pub = await api(h, 'POST', `/api/interviews/${interview.id}/publish`);
  const pid = (await jsonOf(pub)).interview.publicId;
  console.log('PID=', pid);
  const r1 = await (h.env.DB as any).prepare("SELECT id, public_id FROM interviews WHERE public_id = ? AND status IN ('published','inactive')").bind(pid).first(null);
  console.log('DIRECT first:', JSON.stringify(r1));
  const g = await h.request(`/api/public/interviews/${pid}`);
  console.log('GET status', g.status);
});
