import { test, expect } from '@playwright/test';

test('error handoff reviews screenshot and requires final customer consent', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], cancel: () => {}, speak: (u: SpeechSynthesisUtterance) => setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 10) } });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const paint = () => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#243447'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = 'white'; ctx.fillText('Banking error screen for consent test', 10, 50); };
      paint(); const stream = canvas.captureStream(15);
      const repaint = setInterval(paint, 50);
      const track = stream.getVideoTracks()[0]; const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(repaint); stop(); (window as typeof window & { captureStopped: boolean }).captureStopped = true; };
      return stream;
    } });
  });
  let level = 1;
  await page.route('**/api/agent/chat', async route => {
    const request = route.request().postDataJSON();
    if (request.actionId === 'advisory:more') level = 3;
    const answer = { text: level === 1 ? 'Quý khách vui lòng đối chiếu thông tin bên thụ hưởng.' : 'MIA xin phép ghi nhận thông tin để tiếp tục hỗ trợ.', steps: level === 1 ? ['Kiểm tra số tài khoản.'] : [], suggestions: level === 1 ? [{ id: 'more', label: 'Hướng dẫn thêm', actionId: 'advisory:more' }] : [], citations: [], advisory: { level, turns: level === 3 ? 3 : 0, limit: 3, errorCode: '11001', description: 'Không xác định được bên thụ hưởng.', publishedSteps: ['Kiểm tra số tài khoản.'], history: [] } };
    await route.fulfill({ contentType: 'text/event-stream', body: `event: response\ndata: ${JSON.stringify(answer)}\n\nevent: done\ndata: {}\n\n` });
  });
  let submissions = 0;
  await page.route('**/api/host/support/*', async route => {
    submissions++;
    const data = route.request().postDataJSON();
    expect(data.consent).toBe(true); expect(data.screenshot).toMatch(/^data:image\/png;base64,/);
    expect(data.phoneNumber).toBe('0901234567'); expect(data.companyName).toBe('Doanh nghiệp demo');
    await route.fulfill({ json: { ticketId: 'MIA-TEST', channels: { email: 'pending-configuration', zalo: 'pending-configuration' }, message: 'MIA đã ghi nhận hồ sơ; các kênh gửi đang chờ cấu hình.' } });
  });
  await page.goto('/');
  await page.getByPlaceholder('Nhập tên đăng nhập').fill('so');
  await page.getByPlaceholder('Nhập mật khẩu').fill('demo');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Giải ngân', exact: true }).last().click();
  await page.getByRole('button', { name: /Thanh toán nội địa/ }).click();
  await page.getByPlaceholder('Nhập số tài khoản hoặc chọn từ danh bạ').fill('999000000001');
  await page.getByPlaceholder('Nhập số tài khoản hoặc chọn từ danh bạ').blur();
  await page.getByRole('button', { name: /Mở trợ lý MIA/ }).click();
  const mia = page.frameLocator('iframe[title="MIA Assistant"]');
  await mia.getByRole('button', { name: 'Hướng dẫn thêm', exact: true }).click();
  expect(submissions).toBe(0);
  await mia.getByRole('button', { name: 'Đồng ý ghi nhận thông tin', exact: true }).click();
  await expect(mia.getByLabel('Khách hàng', { exact: true })).not.toHaveValue('');
  await mia.getByLabel('Số điện thoại', { exact: true }).fill('0901234567');
  await mia.getByLabel('Tên doanh nghiệp', { exact: true }).fill('Doanh nghiệp demo');
  await expect(mia.getByRole('button', { name: 'Tôi đồng ý gửi hồ sơ và ảnh này' })).toBeDisabled();
  await mia.getByRole('button', { name: 'Chụp tab ngân hàng' }).click();
  const preview = mia.getByRole('img', { name: /Ảnh màn hình lỗi/ });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(640);
  expect(await page.frames().find(frame => frame.url().includes('/assistant/'))!.evaluate(() => (window as typeof window & { captureStopped: boolean }).captureStopped)).toBe(true);
  expect(submissions).toBe(0);
  await mia.getByRole('button', { name: 'Tôi đồng ý gửi hồ sơ và ảnh này' }).click();
  await expect(mia.getByRole('status').filter({ hasText: 'chờ cấu hình' })).toBeVisible();
  expect(submissions).toBe(1);
  await page.screenshot({ path: 'test-results/mia-support-consent.png' });
});
