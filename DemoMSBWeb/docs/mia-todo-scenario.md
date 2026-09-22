# MIA — Mi - A: kịch bản việc cần làm

Nguồn dữ liệu duy nhất trên DemoMSBWeb là `config/demo-assistant-data.yaml`.
`services/demo-banking-api/app/assistant_data.py` kiểm tra cấu hình và chụp dữ liệu theo phiên đăng nhập.
`services/demo-banking-api/app/main.py` cung cấp API;
`apps/web/src/AssistantLauncher.tsx` kết nối MIA;
`apps/web/src/MiaWorkspace.tsx` hiển thị nhóm việc và thống kê;
`apps/web/src/mia-glass.css` định nghĩa giao diện.

Phía MIAAssistant, các file liên quan là `packages/contracts/src/scenarios.ts`,
`apps/assistant-web/src/scenario-runtime.ts`, `apps/assistant-web/src/main.tsx`
và `docs/mia-scenarios.md`. Chúng mô tả hợp đồng, chạy và hiển thị kịch bản, không phải nguồn chi tiết việc cần làm mới của DemoMSBWeb.

Mỗi việc có `todolistID` duy nhất trong danh sách khách hàng, `todotype` và `dueDate` (YYYY-MM-DD).

| todotype | Loại việc | Chi tiết bắt buộc |
| --- | --- | --- |
| overdue-loan | Khoản vay quá hạn | loanAccount; amount là số tiền VND tùy chọn |
| document-debt | Nợ chứng từ | business: Giải ngân hoặc Thanh toán T/T từ vốn tự có |
| password-change | Thay đổi mật khẩu | dueDate: hạn đổi mật khẩu để tránh gián đoạn giao dịch |

`GET /api/host/assistant-data/{sessionId}?details=true` trả dữ liệu chi tiết và
`statistics.total`, `statistics.byType`. API không có query vẫn trả hợp đồng 1.1
(`id`, `todoType`) cho cầu nối MIA; hợp đồng bổ sung chi tiết tùy chọn
`loanAccount`, `business`, `dueDate`, `amount` để giao diện iframe dùng cùng dữ liệu.
Cấu hình được chụp khi đăng nhập, vì vậy sau khi reload cấu hình cần đăng nhập lại để có dữ liệu mới.

| Khách hàng | Vay quá hạn | Nợ chứng từ | Đổi mật khẩu | Tổng |
| --- | ---: | ---: | ---: | ---: |
| so | 3 | 2 | 1 | 6 |
| Ly | 0 | 1 | 0 | 1 |
| tanh | 1 | 0 | 0 | 1 |
| hoa | 0 | 0 | 1 | 1 |
| thu | 0 | 0 | 0 | 0 |
| khoi | 0 | 0 | 0 | 0 |
| minh | 3 | 2 | 1 | 6 |
| lan | 0 | 1 | 0 | 1 |

Kịch bản: đăng nhập `so`, mở MIA, chọn Công việc hằng ngày. Hiển thị tổng 6 việc,
3 tài khoản vay riêng, 2 nghiệp vụ nợ chứng từ và hạn đổi mật khẩu 25/09/2026.
Các nhóm có thể thu gọn. Chọn Trang chủ để trở về ba nhóm tương tác.
Điều hướng giao diện ngân hàng sang giải ngân sẽ mở nhóm giao dịch; về home sẽ khôi phục
trang chủ tương tác MIA. Nhóm khác không xuất hiện khi đang xem công việc hoặc ưu đãi.

Panel cao 2/3 viewport động, nội dung việc ở phần dưới sau phần giới thiệu, có cuộn độc lập.
Màu nền tối, ánh xanh và nâu vàng, viền kính mờ lấy cảm hứng từ ảnh tham khảo.
Nhãn vẫn là MIA; phần đọc qua Web Voice thay MIA bằng Mi - A.
Nội dung iframe giao dịch do MIAAssistant cung cấp và đã áp dụng theme liquid glass.
Chạm việc hoặc yêu cầu bằng giọng nói tạo câu xác nhận; Mở ngay/đồng ý mới điều hướng.
Mã việc được kiểm tra theo phiên rồi ánh xạ sang đúng tài khoản vay, nghiệp vụ chứng từ
hoặc hạn đổi mật khẩu. Sidebar khoản vay chiếm 1/3 màn hình desktop, mobile toàn chiều rộng.
API `/api/host/credit-information/{sessionId}` cung cấp cùng tài khoản vay trong todoList;
dư nợ và lịch trả nợ là số liệu demo tính từ số tiền quá hạn.

## Cấu hình dịch vụ MIA cho DemoMSBWeb

`config/mia-scenarios.yaml` khai báo ba todotype mới và đọc thống kê cả ba loại.
Dịch vụ MIA phải dùng file này, vì cấu hình mặc định của MIAAssistant chỉ biết các loại cũ.
Chạy từ DemoMSBWeb:

```powershell
docker compose -f ../MIAAssistant/compose.yaml -f compose.mia.yaml up -d --build
```

Nếu chạy Python trực tiếp, đặt `MIA_SCENARIO_CONFIG` bằng đường dẫn tuyệt đối tới
`DemoMSBWeb/config/mia-scenarios.yaml` trước khi khởi động agent-api.
Cấu hình Playwright đã đặt biến này cho dịch vụ kiểm thử.
