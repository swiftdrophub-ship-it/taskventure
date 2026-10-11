const base = process.env.BASE_URL || 'http://127.0.0.1:4179';
const unique = `smoke${Date.now()}`;
async function client() {
  let cookie = '';
  return {
    async request(path, method = 'GET', body) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const data = await response.json();
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.error}`);
      return data;
    }
  };
}
(async () => {
  const healthResponse = await fetch(`${base}/api/health`);
  const headers = Object.fromEntries(healthResponse.headers.entries());
  const health = await healthResponse.json();
  if (!health.ok || !String(health.database || '').trim().endsWith('.db')) throw new Error('SQLite health check failed.');
  if (headers['x-frame-options'] !== 'DENY' || !headers['content-security-policy']) throw new Error('Security headers are missing.');
  const poster = await client();
  const tasker = await client();
  const posterIdentity = { name: `Poster ${unique}`, email: `poster.${unique}@example.test`, password: 'localDevPass123' };
  const taskerIdentity = { name: `Tasker ${unique}`, email: `tasker.${unique}@example.test`, password: 'localDevPass123' };
  const posterRegistration = await poster.request('/api/auth/register', 'POST', posterIdentity);
  if (!posterRegistration.developmentLink) throw new Error('Development verification link was not returned.');
  const blocked = await poster.request('/api/state');
  if (blocked.state.user.emailVerified) throw new Error('New user should require verification.');
  const verifyPosterToken = new URL(posterRegistration.developmentLink).searchParams.get('verify');
  await poster.request('/api/auth/verify', 'POST', { token: verifyPosterToken });
  const created = await poster.request('/api/tasks', 'POST', { title:'Shared SQLite test task', description:'A task created by the security smoke test.', category:'Assembly', pay:40, area:'Test area', when:'Tomorrow' });
  const taskId = created.task.id;
  const taskerRegistration = await tasker.request('/api/auth/register', 'POST', taskerIdentity);
  const verifyTaskerToken = new URL(taskerRegistration.developmentLink).searchParams.get('verify');
  await tasker.request('/api/auth/verify', 'POST', { token: verifyTaskerToken });
  await tasker.request(`/api/tasks/${taskId}/claim`, 'POST', {});
  await tasker.request(`/api/tasks/${taskId}/messages`, 'POST', { text:'I can complete this tomorrow.' });
  await tasker.request(`/api/tasks/${taskId}/start`, 'POST', {});
  await tasker.request(`/api/tasks/${taskId}/report`, 'POST', {});
  const posterBefore = await poster.request('/api/state');
  if (!posterBefore.state.tasks.some(task => task.id === taskId && task.status === 'completion_pending')) throw new Error('Poster could not see pending shared task.');
  await poster.request(`/api/tasks/${taskId}/confirm`, 'POST', {});
  const taskerAfter = await tasker.request('/api/state');
  const finished = taskerAfter.state.tasks.find(task => task.id === taskId);
  if (!finished || finished.status !== 'completed') throw new Error('Tasker could not see confirmed completion.');
  if (taskerAfter.state.user.completed !== 1 || taskerAfter.state.user.xp !== 40) throw new Error('Tasker rewards were not persisted.');
  const reset = await tasker.request('/api/auth/request-password-reset', 'POST', { email: taskerIdentity.email });
  const resetToken = new URL(reset.developmentLink).searchParams.get('reset');
  await tasker.request('/api/auth/reset-password', 'POST', { token: resetToken, password: 'UpdatedPass456' });
  await tasker.request('/api/auth/logout', 'POST', {});
  await tasker.request('/api/auth/login', 'POST', { email: taskerIdentity.email, password: 'UpdatedPass456' });
  console.log(JSON.stringify({ ok:true, database:health.database, taskId, status:finished.status, taskerXp:taskerAfter.state.user.xp, taskerCompleted:taskerAfter.state.user.completed, securityHeaders:'present', emailVerification:'passed', passwordReset:'passed' }));
})().catch(error => { console.error(error.stack); process.exit(1); });
