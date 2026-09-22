# Tư vấn lỗi và tiếp nhận hỗ trợ

MIAAssistant chịu trách nhiệm nhận hồ sơ và gửi cả email lẫn Zalo. Luồng hiện tại: assistant bubble → bridge của host → host kiểm tra phiên/màn hình và bổ sung danh tính → `POST /api/agent/support` tại MIAAssistant → lưu hồ sơ → gửi SMTP và webhook chatbot Zalo. DemoMSBWeb chỉ xác thực và chuyển tiếp; không giữ thông tin đăng nhập SMTP/Zalo, không gửi tới các kênh này. Các cấu hình nhận/gửi đều nằm ở MIAAssistant.

Giao diện có ba mức: hướng dẫn nguyên văn từ advisory-knowledge; hỏi đáp GLM tối đa ba lượt; xin phép tiếp nhận hồ sơ. Giới hạn nằm trên máy chủ, theo phiên và mã lỗi. Mở lại panel hoặc phát sinh lại cùng mã lỗi không làm mới số lượt. Lượt thất bại không tính. Ngữ cảnh gửi GLM gồm mô tả, bước gốc và trao đổi trước đó; ảnh và thông tin liên hệ không gửi GLM.

Khi màn hình có lỗi, ẩn nút “Hướng dẫn sử dụng” và “Yêu cầu khác”. Câu hỏi nhập text hoặc nhận từ giọng nói được dùng ngay làm dữ liệu bổ sung cho GLM, kể cả trước khi bấm “Hướng dẫn thêm”. GLM phân biệt hỏi tiếp về lỗi với yêu cầu đổi công việc dựa trên ngữ cảnh. Yêu cầu mới được hỏi xác nhận; khách hàng đồng ý bằng text, giọng nói hoặc nút “Đồng ý” thì chuyển sang luồng tương ứng. Điều hướng vẫn cần xác nhận đích đến qua bridge của host. Đổi ý hoặc từ chối không tiêu hao lượt hỏi đáp lỗi.

Khách hàng đồng ý ghi nhận, kiểm tra số điện thoại/doanh nghiệp, chủ động chọn tab ngân hàng để chụp, xem ảnh và nhấn đồng ý gửi. Hủy hoặc từ chối quyền chụp sẽ không gửi hồ sơ. Chụp tab cần Chrome/Edge và HTTPS hoặc localhost. Luồng capture dừng ngay sau khi lấy ảnh.

Thông tin tên/tài khoản lấy từ phiên đăng nhập của host. Có thể thêm `phoneNumber`, `companyName` cho từng user trong `DemoMSBWeb/config/demo-users.yaml`; nếu thiếu, khách hàng điền trên biểu mẫu. Host kiểm tra mã lỗi hiện tại trước khi chuyển hồ sơ.

## Cấu hình gửi

Đặt trong `.env` của MIAAssistant: `MIA_SUPPORT_SMTP_HOST`, `MIA_SUPPORT_SMTP_PORT`, `MIA_SUPPORT_SMTP_SECURITY` (`starttls` hoặc `ssl`), `MIA_SUPPORT_SMTP_USER`, `MIA_SUPPORT_SMTP_PASSWORD`, `MIA_SUPPORT_EMAIL_FROM`, `MIA_SUPPORT_EMAIL_TO`.

Đặt `MIA_SUPPORT_ZALO_WEBHOOK_URL` là endpoint tiếp nhận của chatbot Zalo đã tích hợp; `MIA_SUPPORT_ZALO_TOKEN` tùy chọn dùng Bearer. Endpoint nhận JSON gồm ticketId, sessionId, contact (username/fullName/phoneNumber/companyName), screenId, function, errorCode, description, publishedSteps, conversation, screenshot (PNG data URI), consentedAt. Chatbot phải chuyển nội dung và ảnh tới đích Zalo của đơn vị, xử lý Idempotency-Key và trả `{ "accepted": true }` sau khi chấp nhận hoặc `{ "error": 0 }`. Đây là adapter webhook, không tự tạo Zalo OA hoặc địa chỉ người nhận.

Host Docker dùng `MIA_SUPPORT_ASSISTANT_API_URL=http://host.docker.internal:8090`; thay đổi nếu assistant chạy tại máy/port khác.

SQLite `MIA_SUPPORT_DB=/app/data/support.sqlite3` lưu ngữ cảnh và hồ sơ trên volume `support-data`. Không có cấu hình hoặc gửi lỗi: hồ sơ vẫn được ghi nhận, giao diện báo chưa chuyển xong và cho thử lại. Thử lại giữ mã hồ sơ và bỏ qua kênh đã gửi thành công. Không có worker tự gửi nền. Sao lưu và giới hạn lưu trữ volume theo chính sách của đơn vị vì có thông tin liên hệ và ảnh màn hình.
