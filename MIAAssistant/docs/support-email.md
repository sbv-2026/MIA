# Cấu hình gửi hồ sơ hỗ trợ

Trong `.env` của MIAAssistant, cấu hình:

```dotenv
MIA_SUPPORT_EMAIL_TO=vips8157@gmail.com
MIA_SUPPORT_SMTP_HOST=smtp.gmail.com
MIA_SUPPORT_SMTP_PORT=587
MIA_SUPPORT_SMTP_SECURITY=starttls
MIA_SUPPORT_SMTP_USER=vnjp201302@gmail.com
MIA_SUPPORT_EMAIL_FROM=vnjp201302@gmail.com
MIA_SUPPORT_SMTP_PASSWORD=saochuabiet123
```

`MIA_SUPPORT_SMTP_HOST` là địa chỉ máy chủ (`smtp.gmail.com`), không phải email. `MIA_SUPPORT_SMTP_USER=vips8157@gmail.com` là tài khoản đăng nhập, đồng thời là người gửi. `MIA_SUPPORT_EMAIL_TO=vips8157@gmail.com` là người nhận. Email khách hàng lấy từ `user_email` trong cấu hình user và được thêm vào CC. Với Gmail, điền mật khẩu ứng dụng vào `MIA_SUPPORT_SMTP_PASSWORD`; không đưa mật khẩu vào mã nguồn. Nếu gửi thất bại, hồ sơ và ảnh được giữ lại để gửi lại, không báo đã gửi thành công.

Số điện thoại và tên doanh nghiệp được tự điền từ `phoneNumber` và `Corp_name` trong cấu hình user. Trường đang để trống cần được điền bằng dữ liệu thực tế.

Ứng dụng hiển thị hộp thoại “Chụp màn hình lỗi” bằng tiếng Việt. Cửa sổ chọn tab do trình duyệt quản lý; ngôn ngữ của cửa sổ này phụ thuộc ngôn ngữ Chrome/Edge, ứng dụng không thể đổi tiêu đề bằng mã JavaScript.

`Full name` dùng để hiển thị trên web/app; `name` dùng cùng danh xưng khi trao đổi. Các trường liên hệ để trống cần được điền bằng dữ liệu thực tế.

Sau khi cập nhật `.env`, chạy `docker compose up -d --build` trong MIAAssistant. Trình duyệt yêu cầu khách hàng chọn tab ngân hàng khi chụp; MIA tạm ẩn trước khi lấy ảnh rồi hiện lại, không kết thúc phiên. Ảnh, mã hồ sơ và trạng thái gửi được giữ đến khi kết thúc phiên đăng nhập.
