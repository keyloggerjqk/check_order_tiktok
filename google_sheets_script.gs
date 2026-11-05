/**
 * Google Apps Script tự động kiểm tra đơn hàng TikTok Shop
 * API Endpoint: https://checkordertiktok-seven.vercel.app/api/check-order
 *
 * Cấu trúc các cột trên Google Sheet (Dòng 1 là tiêu đề, dữ liệu từ Dòng 2):
 * Cột A (1): cookie
 * Cột B (2): mvd
 * Cột C (3): tên ng nhận
 * Cột D (4): sdt
 * Cột E (5): địa chỉ
 * Cột F (6): tiền cod
 * Cột G (7): trạng thái đơn hàng (Tô màu tự động theo trạng thái)
 * Cột H (8): hành trình cuối đơn hàng
 * Cột I (9): thời gian đặt
 * Cột J (10): tên sản phẩm
 * Cột K (11): cập nhật lúc
 */

const API_URL = "https://checkordertiktok-seven.vercel.app/api/check-order";

const STATUS_STYLES = {
  DELIVERED: { bg: "#bbf7d0", fg: "#14532d" }, // Xanh lá (Giao thành công)
  SHIPPING:  { bg: "#fef08a", fg: "#713f12" }, // Vàng (Đang giao / Đang vận chuyển / Chuẩn bị hàng)
  RETURNED:  { bg: "#e9d5ff", fg: "#581c87" }, // Tím (Đơn hoàn / Trả hàng)
  CANCELLED: { bg: "#fecaca", fg: "#7f1d1d" }, // Đỏ (Đơn huỷ / Lỗi)
  DEFAULT:   { bg: "#f1f5f9", fg: "#334155" }, // Xám nhạt (Chưa có đơn)
};

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
    "tiền cod",
    "trạng thái đơn hàng",
    "hành trình cuối đơn hàng",
    "thời gian đặt",
    "tên sản phẩm",
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
 * Phân loại màu sắc theo trạng thái đơn hàng và hành trình cuối
 * - Giao thành công -> Xanh lá
 * - Đang giao / Chuẩn bị hàng -> Vàng
 * - Đơn hoàn / Trả hàng -> Tím
 * - Đơn huỷ -> Đỏ
 */
function classifyOrderStatusStyle(order, trangThaiText, hanhTrinhText) {
  const code = Number(order.order_status_code || 0);
  const statusName = String(order.order_status_name || "").toLowerCase();
  const combined = `${statusName} ${trangThaiText} ${hanhTrinhText}`.toLowerCase();

  // 1. Đơn hoàn / Trả hàng -> Màu Tím
  if (
    code === 8 ||
    combined.includes("return") ||
    combined.includes("refund") ||
    combined.includes("hoàn") ||
    combined.includes("trả hàng") ||
    combined.includes("unsuccessful") ||
    combined.includes("delivery failed") ||
    combined.includes("giao không thành công")
  ) {
    return STATUS_STYLES.RETURNED;
  }

  // 2. Đơn huỷ -> Màu Đỏ
  if (
    combined.includes("cancel") ||
    combined.includes("đã hủy") ||
    combined.includes("đã huỷ") ||
    combined.includes("hủy đơn") ||
    combined.includes("huỷ đơn")
  ) {
    return STATUS_STYLES.CANCELLED;
  }

  // 3. Đơn giao thành công -> Màu Xanh lá
  if (
    code === 4 ||
    code === 5 ||
    statusName === "500" ||
    statusName === "completed" ||
    combined.includes("delivered") ||
    combined.includes("đã giao") ||
    combined.includes("giao thành công")
  ) {
    return STATUS_STYLES.DELIVERED;
  }

  // 4. Đơn đang giao / Đang vận chuyển / Đã đặt -> Màu Vàng
  if (
    code === 1 ||
    code === 2 ||
    code === 3 ||
    combined.includes("transit") ||
    combined.includes("out for delivery") ||
    combined.includes("shipped") ||
    combined.includes("preparing") ||
    combined.includes("order placed") ||
    combined.includes("picked up") ||
    combined.includes("sorting center") ||
    combined.includes("delivery hub") ||
    combined.includes("ready_to_ship") ||
    combined.includes("đang giao") ||
    combined.includes("vận chuyển")
  ) {
    return STATUS_STYLES.SHIPPING;
  }

  return STATUS_STYLES.SHIPPING;
}

/**
 * Hàm chính: Quét toàn bộ cột A (cookie) từ dòng 2 và điền thông tin đơn hàng vào cột B -> K
 */
function checkAllTikTokOrders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Chưa có dữ liệu cookie ở dòng 2 trở đi.");
    return;
  }

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

    const statusCell = sheet.getRange(rowIndex, 7); // Cột G (7): trạng thái đơn hàng

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
          .getRange(rowIndex, 2, 1, 10)
          .setValues([["", "", "", "", "", `Lỗi: ${errMsg}`, "", "", "", nowStr]]);
        statusCell
          .setBackground(STATUS_STYLES.CANCELLED.bg)
          .setFontColor(STATUS_STYLES.CANCELLED.fg)
          .setFontWeight("bold");
        continue;
      }

      const orders = json.orders || [];
      if (orders.length === 0) {
        const addr = (json.address_book || [])[0] || {};
        sheet.getRange(rowIndex, 2, 1, 10).setValues([
          [
            "Chưa có đơn",
            addr.recipient_name || "",
            addr.phone ? `'${addr.phone}` : "",
            addr.address || "",
            "",
            "Không có đơn hàng",
            "",
            "",
            "",
            nowStr,
          ],
        ]);
        statusCell
          .setBackground(STATUS_STYLES.DEFAULT.bg)
          .setFontColor(STATUS_STYLES.DEFAULT.fg)
          .setFontWeight("normal");
        continue;
      }

      // Lấy đơn hàng mới nhất (orders[0])
      const order = orders[0];
      const mvd =
        order.ma_van_don ||
        (order.ma_kien_hang ? `Kiện: ${order.ma_kien_hang}` : "Chưa có MVĐ");
      const tenNguoiNhan = order.ten_nguoi_nhan || "";
      const sdt = order.so_dien_thoai ? `'${order.so_dien_thoai}` : "";
      const diaChi = order.dia_chi || "";
      const tienCod = order.tien_cod_vnd || "";

      const trangThai = [order.order_status_title, order.order_status_detail]
        .filter(Boolean)
        .join(" - ");

      // Lấy mốc hành trình cuối cùng (phần tử đầu tiên trong mảng hanh_trinh_don_hang)
      const timeline = order.hanh_trinh_don_hang || [];
      let hanhTrinhCuoi = "";
      if (timeline.length > 0) {
        const latest = timeline[0];
        const parts = [];
        if (latest.thoi_gian) parts.push(`[${latest.thoi_gian}]`);
        if (latest.trang_thai) parts.push(latest.trang_thai);
        if (latest.mo_ta) parts.push(latest.mo_ta.replace(/\n/g, " "));
        if (latest.sdt_buu_ta) {
          parts.push(`(Shipper: ${latest.buu_ta || ""} ${latest.sdt_buu_ta})`);
        }
        hanhTrinhCuoi = parts.join(" ");
      }

      const thoiGianDat = order.ngay_gio_dat_don ? `'${order.ngay_gio_dat_don}` : "";
      const tenSanPham = `${order.ten_san_pham || ""} (x${order.so_luong || 1})`;

      // Ghi kết quả vào cột B -> K (10 cột)
      sheet.getRange(rowIndex, 2, 1, 10).setValues([
        [
          `'${mvd}`,
          tenNguoiNhan,
          sdt,
          diaChi,
          tienCod,
          trangThai,
          hanhTrinhCuoi,
          thoiGianDat,
          tenSanPham,
          nowStr,
        ],
      ]);

      // Tô màu ô Trạng thái đơn hàng (Cột G) theo phân loại
      const style = classifyOrderStatusStyle(order, trangThai, hanhTrinhCuoi);
      statusCell
        .setBackground(style.bg)
        .setFontColor(style.fg)
        .setFontWeight("bold");

      Utilities.sleep(300);
    } catch (err) {
      sheet
        .getRange(rowIndex, 2, 1, 10)
        .setValues([["", "", "", "", "", `Exception: ${err.message}`, "", "", "", nowStr]]);
      statusCell
        .setBackground(STATUS_STYLES.CANCELLED.bg)
        .setFontColor(STATUS_STYLES.CANCELLED.fg)
        .setFontWeight("bold");
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
    SpreadsheetApp.getUi().alert("🛑 Đã tắt tự động kiểm tra.");
  }
}
