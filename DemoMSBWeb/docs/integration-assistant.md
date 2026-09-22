# Tích hợp MIAAssistant

DemoMSBWeb tiêu thụ `@mia/web-context-adapter` theo version (hiện là 0.2.2). Biến runtime `ASSISTANT_URL` xác định cả iframe URL trả bởi `GET /api/config/assistant` và CSP `frame-src`, để URL và exact origin không bị lệch nhau. Contract và protocol chuẩn thuộc repo MIAAssistant.

## Demo qua Wi-Fi

Gateway tích hợp chính chạy ở MIAAssistant cổng `8090` (không dùng sandbox standalone cổng 8080). Sao chép `.env.example` thành `.env`, thay `192.168.1.10` bằng IPv4 LAN của laptop và đặt `ASSISTANT_URL=http://<IP_LAPTOP>:8090/assistant/`. Mở DemoMSBWeb bằng `http://<IP_LAPTOP>:8081`.

Trong `MIAAssistant/.env`, thêm `http://<IP_LAPTOP>:8081` vào `ALLOWED_HOST_ORIGINS`. Cho phép inbound TCP 8081 và 8090 trên Windows Firewall, và bảo đảm laptop/điện thoại ở cùng mạng. BlueStacks có thể dùng `10.0.2.2` khi truy cập dịch vụ trên host; điện thoại thật phải dùng IPv4 LAN của laptop.

Lỗi inline được đẩy lên Host ngay khi blur để `currentError`, snapshot và `contextKey` dùng cùng một error ID; khi người dùng sửa trường, cả ba cùng được xóa.


## Kịch bản MIA và cá nhân hóa

Kịch bản chuẩn: [mia-scenarios.md](../../MIAAssistant/docs/mia-scenarios.md). Cấu hình user/customer thuộc backend DemoMSBWeb; xem [mia-configuration.md](../../MIAAssistant/docs/mia-configuration.md). Web pin contracts/Web adapter 0.2.0, khởi tạo iframe sau login và tích hợp extension opt-in 1.1. MIA_SCENARIOS_ENABLED=false giữ chat 1.0. Hai backend local E2E dùng cổng 18081/18090; tại apps/web chạy npm run build, npm run test:e2e sau khi build MIAAssistant. Playwright mặc định Chrome có sẵn, MIA_E2E_BROWSER_CHANNEL cho phép đổi channel.
