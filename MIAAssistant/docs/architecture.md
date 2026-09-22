# Kiến trúc MIAAssistant

Assistant UI chạy tại origin riêng trong iframe/WebView. Adapter chạy trong Host, thu thập context allowlist và trả `ContextSnapshot` qua bridge. UI gửi snapshot tới Agent API cùng origin bằng SSE. Agent chỉ đọc snapshot và knowledge dataset `published`; không gọi hoặc thay đổi giao dịch Host.

`packages/contracts` là nguồn chuẩn. Hai adapter phụ thuộc package này và được phát hành cùng compatibility matrix.
