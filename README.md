# TikTok Shop Order Checker (Node.js & Vercel)

Công cụ và API kiểm tra thông tin đơn hàng TikTok Shop chỉ bằng Cookie `sessionid` (không cần cài thêm thư viện ngoài).

## Dữ liệu trả về
- `ten_san_pham`, `so_luong`, `product_id`, `sku_id`, `product_image`
- `ngay_gio_dat_don`, `order_status_title`, `order_status_detail`
- `ten_nguoi_nhan`, `so_dien_thoai` (SĐT gốc không bị che), `dia_chi`
- `tien_cod_vnd`, `tien_cod_usd`
- `ma_van_don`, `ma_kien_hang`, `don_vi_van_chuyen`, `ten_shipper`, `sdt_shipper`
- `hanh_trinh_don_hang` (Chi tiết từng mốc vận chuyển)

## 1. Deploy lên Vercel
Import trực tiếp repository này vào [Vercel](https://vercel.com/new) và bấm **Deploy**.
- **Giao diện Web**: `https://<domain-cua-ban>.vercel.app/`
- **Trang Swagger UI**: `https://<domain-cua-ban>.vercel.app/docs` (hoặc `/swagger`)
- **OpenAPI Spec**: `https://<domain-cua-ban>.vercel.app/openapi.json`
- **API GET**: `GET /api/check-order?sessionid=<SESSION_ID>`
- **API POST**: `POST /api/check-order` với body `{"sessionid": "<SESSION_ID>"}`

## 2. Chạy trực tiếp bằng Node.js
```bash
# Chạy CLI kiểm tra 1 sessionid
node tiktok_order_checker.js <sessionid>

# Hoặc chạy HTTP API Server tại cổng 3000
npm start
```

