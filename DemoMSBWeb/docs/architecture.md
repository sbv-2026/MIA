# Kiến trúc DemoMSBWeb

Một image phục vụ React Host và FastAPI demo banking API. DemoMSBWeb là nguồn sự thật cho session, route, giao dịch và lỗi. Assistant được tải qua iframe khác origin và chỉ nhận snapshot đã lọc qua `@mia/web-context-adapter`.

DemoMSBApp dùng cùng banking API; Agent không có quyền gọi endpoint submit.
