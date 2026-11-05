/**
 * Google Apps Script tự động kiểm tra đơn hàng TikTok Shop mỗi 1 tiếng
 * API Endpoint: https://checkordertiktok-seven.vercel.app/api/check-order
 *
 * Cấu trúc 8 cột trên Google Sheet (Dòng 1 là tiêu đề, dữ liệu từ Dòng 2):
 * Cột A (1): cookie
 * Cột B (2): mvd
 * Cột C (3): tên ng nhận
 * Cột D (4): sdt
 * Cột E (5): địa chỉ
 * Cột F (6): trạng thái đơn hàng
 * Cột G (7): hành trình cuối đơn hàng
 * Cột H (8): thời gian đặt
 * (Tùy chọn Cột I (9): tên sản phẩm & tiền COD, Cột J (10): cập nhật lúc)
 */

const API_URL = "https://checkordertiktok-seven.vercel.app/api/check-order";

/**
 * Tạo menu tiện ích trên thanh công cụ Google Sheet khi mở file
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📦 TikTok Order Checker")
    .addItem("▶️ Chạy kiểm tra đơn ngay", "checkAllTikTokOrders")
    .addItem("📋 Tạo dòng tiêu đề chuẩn (Dòng 1)", "setupSheetHeaders")
    .addSeparator()
    .addItem("⏱️ Bật tự động check mỗi 15 phút", "enable15MinTrigger")
    .addItem("⏱️ Bật tự động check mỗi 30 phút", "enable30MinTrigger")
    .addItem("⏰ Bật tự động check mỗi 1 tiếng", "enableHourlyTrigger")
    .addItem("🛑 Tắt tự động check", "disableTriggers")
    .addToUi();
}

/**
 * Khởi tạo tiêu đề cột chuẩn ở dòng 1
 */
function setupSheetHeaders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const headers = [
    "cookie",
    "mvd",
    "tên ng nhận",
    "sdt",
    "địa chỉ",
    "trạng thái đơn hàng",
    "hành trình cuối đơn hàng",
    "thời gian đặt",
    "tên sản phẩm & COD",
    "cập nhật lúc",
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#0f172a")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
}

/**
 * Hàm chính: Quét toàn bộ cột A (cookie) từ dòng 2 và điền thông tin đơn hàng vào cột B -> J
 */
function checkAllTikTokOrders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Chưa có dữ liệu cookie ở dòng 2 trở đi.");
    return;
  }

  // Đọc toàn bộ cột A từ dòng 2 đến dòng cuối
  const cookieRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const nowStr = Utilities.formatDate(
    new Date(),
    "Asia/Ho_Chi_Minh",
    "yyyy-MM-dd HH:mm:ss"
  );

  for (let i = 0; i < cookieRange.length; i++) {
    const rowIndex = i + 2;
    const rawCookie = String(cookieRange[i][0] || "").trim();
    if (!rawCookie) continue;

    try {
      const response = UrlFetchApp.fetch(API_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ sessionid: rawCookie }),
        muteHttpExceptions: true,
      });

      const statusCode = response.getResponseCode();
      const json = JSON.parse(response.getContentText() || "{}");

      if (statusCode !== 200 || !json.success) {
        const errMsg = json.message || json.error || `HTTP ${statusCode}`;
        sheet
          .getRange(rowIndex, 2, 1, 9)
          .setValues([["", "", "", "", `Lỗi: ${errMsg}`, "", "", "", nowStr]]);
        continue;
      }

      const orders = json.orders || [];
      if (orders.length === 0) {
        // Trường hợp tài khoản không có đơn hàng nhưng có sổ địa chỉ
        const addr = (json.address_book || [])[0] || {};
        sheet.getRange(rowIndex, 2, 1, 9).setValues([
          [
            "Chưa có đơn",
            addr.recipient_name || "",
            addr.phone ? `'${addr.phone}` : "",
            addr.address || "",
            "Không có đơn hàng",
            "",
            "",
            "",
            nowStr,
          ],
        ]);
        continue;
      }

      // Lấy đơn hàng mới nhất (orders[0])
      const order = orders[0];
      const mvd = order.ma_van_don || (order.ma_kien_hang ? `Kiện: ${order.ma_kien_hang}` : "Chưa có MVĐ");
      const tenNguoiNhan = order.ten_nguoi_nhan || "";
      // Thêm dấu nháy đơn ' ở đầu SĐT và MVĐ để Google Sheet không tự cắt số 0 hoặc đổi sang số mũ
      const sdt = order.so_dien_thoai ? `'${order.so_dien_thoai}` : "";
      const diaChi = order.dia_chi || "";

      const trangThai = [order.order_status_title, order.order_status_detail]
        .filter(Boolean)
        .join(" - ");

      // Lấy mốc hành trình cuối cùng (mới nhất nằm ở phần tử đầu tiên của hanh_trinh_don_hang)
      const timeline = order.hanh_trinh_don_hang || [];
      let hanhTrinhCuoi = "";
      if (timeline.length > 0) {
        const latest = timeline[0];
        const parts = [];
        if (latest.thoi_gian) parts.push(`[${latest.thoi_gian}]`);
        if (latest.trang_thai) parts.push(latest.trang_thai);
        if (latest.mo_ta) parts.push(latest.mo_ta.replace(/\n/g, " "));
        if (latest.sdt_buu_ta) parts.push(`(Shipper: ${latest.buu_ta || ""} ${latest.sdt_buu_ta})`);
        hanhTrinhCuoi = parts.join(" ");
      }

      const thoiGianDat = order.ngay_gio_dat_don ? `'${order.ngay_gio_dat_don}` : "";
      const sanPhamVaCod = `${order.ten_san_pham || ""} (x${order.so_luong || 1}) | COD: ${order.tien_cod_vnd || ""}`;

      // Ghi kết quả vào cột B -> J (9 cột)
      sheet.getRange(rowIndex, 2, 1, 9).setValues([
        [
          `'${mvd}`,
          tenNguoiNhan,
          sdt,
          diaChi,
          trangThai,
          hanhTrinhCuoi,
          thoiGianDat,
          sanPhamVaCod,
          nowStr,
        ],
      ]);

      // Nghỉ 300ms giữa các dòng để tránh quá tải
      Utilities.sleep(300);
    } catch (err) {
      sheet
        .getRange(rowIndex, 2, 1, 9)
        .setValues([["", "", "", "", `Exception: ${err.message}`, "", "", "", nowStr]]);
    }
  }
}

/**
 * Cài đặt Trigger tự động chạy hàm checkAllTikTokOrders mỗi 15 phút
 */
function enable15MinTrigger() {
  disableTriggers(false);
  ScriptApp.newTrigger("checkAllTikTokOrders")
    .timeBased()
    .everyMinutes(15)
    .create();

  SpreadsheetApp.getUi().alert(
    "✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 15 phút!"
  );
}

/**
 * Cài đặt Trigger tự động chạy hàm checkAllTikTokOrders mỗi 30 phút
 */
function enable30MinTrigger() {
  disableTriggers(false);
  ScriptApp.newTrigger("checkAllTikTokOrders")
    .timeBased()
    .everyMinutes(30)
    .create();

  SpreadsheetApp.getUi().alert(
    "✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 30 phút!"
  );
}

/**
 * Cài đặt Trigger tự động chạy hàm checkAllTikTokOrders mỗi 1 tiếng
 */
function enableHourlyTrigger() {
  disableTriggers(false);
  ScriptApp.newTrigger("checkAllTikTokOrders")
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert(
    "✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 1 tiếng!"
  );
}

/**
 * Xóa các Trigger tự động đã cài đặt
 */
function disableTriggers(showAlert = true) {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === "checkAllTikTokOrders") {
      ScriptApp.deleteTrigger(t);
    }
  }
  if (showAlert) {
    SpreadsheetApp.getUi().alert("🛑 Đã tắt tự động kiểm tra mỗi 1 tiếng.");
  }
}

