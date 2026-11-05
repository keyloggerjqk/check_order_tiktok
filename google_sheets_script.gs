var API_URL = "https://checkordertiktok-seven.vercel.app/api/check-order";

var STATUS_STYLES = {
  DELIVERED: { bg: "#bbf7d0", fg: "#14532d" }, // Xanh lá (Giao thành công)
  SHIPPING:  { bg: "#fef08a", fg: "#713f12" }, // Vàng (Đang giao / Chuẩn bị hàng)
  RETURNED:  { bg: "#e9d5ff", fg: "#581c87" }, // Tím (Đơn hoàn / Trả hàng)
  CANCELLED: { bg: "#fecaca", fg: "#7f1d1d" }, // Đỏ (Đơn huỷ / Lỗi)
  DEFAULT:   { bg: "#f1f5f9", fg: "#334155" }  // Xám nhạt (Chưa có đơn)
};

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu("📦 TikTok Order Checker");
  menu.addItem("▶️ Chạy kiểm tra đơn ngay", "checkAllTikTokOrders");
  menu.addItem("📋 Tạo dòng tiêu đề chuẩn (Dòng 1)", "setupSheetHeaders");
  menu.addSeparator();
  menu.addItem("⏱️ Bật tự động check mỗi 15 phút", "enable15MinTrigger");
  menu.addItem("⏱️ Bật tự động check mỗi 30 phút", "enable30MinTrigger");
  menu.addItem("⏰ Bật tự động check mỗi 1 tiếng", "enableHourlyTrigger");
  menu.addItem("🛑 Tắt tự động check", "disableTriggers");
  menu.addToUi();
}

function setupSheetHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = [
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
    "cập nhật lúc"
  ];
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#0f172a");
  headerRange.setFontColor("#ffffff");
  sheet.setFrozenRows(1);
}

function classifyOrderStatusStyle(order, trangThaiText, hanhTrinhText) {
  var code = Number(order.order_status_code || 0);
  var statusName = String(order.order_status_name || "").toLowerCase();
  var combined = (statusName + " " + trangThaiText + " " + hanhTrinhText).toLowerCase();

  // 1. Đơn hoàn / Trả hàng -> Màu Tím
  if (
    code === 8 ||
    combined.indexOf("return") !== -1 ||
    combined.indexOf("refund") !== -1 ||
    combined.indexOf("hoàn") !== -1 ||
    combined.indexOf("trả hàng") !== -1 ||
    combined.indexOf("unsuccessful") !== -1 ||
    combined.indexOf("delivery failed") !== -1 ||
    combined.indexOf("giao không thành công") !== -1
  ) {
    return STATUS_STYLES.RETURNED;
  }

  // 2. Đơn huỷ -> Màu Đỏ
  if (
    combined.indexOf("cancel") !== -1 ||
    combined.indexOf("đã hủy") !== -1 ||
    combined.indexOf("đã huỷ") !== -1 ||
    combined.indexOf("hủy đơn") !== -1 ||
    combined.indexOf("huỷ đơn") !== -1
  ) {
    return STATUS_STYLES.CANCELLED;
  }

  // 3. Đơn giao thành công -> Màu Xanh lá
  if (
    code === 4 ||
    code === 5 ||
    statusName === "500" ||
    statusName === "completed" ||
    combined.indexOf("delivered") !== -1 ||
    combined.indexOf("đã giao") !== -1 ||
    combined.indexOf("giao thành công") !== -1
  ) {
    return STATUS_STYLES.DELIVERED;
  }

  // 4. Đơn đang giao / Đang vận chuyển / Đã đặt -> Màu Vàng
  return STATUS_STYLES.SHIPPING;
}

function applyCellStyle(cell, style, bold) {
  cell.setBackground(style.bg);
  cell.setFontColor(style.fg);
  cell.setFontWeight(bold ? "bold" : "normal");
}

function checkAllTikTokOrders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Chưa có dữ liệu cookie ở dòng 2 trở đi.");
    return;
  }

  var cookieRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

  for (var i = 0; i < cookieRange.length; i++) {
    var rowIndex = i + 2;
    var rawCookie = String(cookieRange[i][0] || "").trim();
    if (!rawCookie) continue;

    var statusCell = sheet.getRange(rowIndex, 7); // Cột G (7): trạng thái đơn hàng

    try {
      var response = UrlFetchApp.fetch(API_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ sessionid: rawCookie }),
        muteHttpExceptions: true
      });

      var statusCode = response.getResponseCode();
      var json = JSON.parse(response.getContentText() || "{}");

      if (statusCode !== 200 || !json.success) {
        var errMsg = json.message || json.error || ("HTTP " + statusCode);
        sheet.getRange(rowIndex, 2, 1, 10).setValues([
          ["", "", "", "", "", "Lỗi: " + errMsg, "", "", "", nowStr]
        ]);
        applyCellStyle(statusCell, STATUS_STYLES.CANCELLED, true);
        continue;
      }

      var orders = json.orders || [];
      if (orders.length === 0) {
        var addrList = json.address_book || [];
        var addr = addrList.length > 0 ? addrList[0] : {};
        sheet.getRange(rowIndex, 2, 1, 10).setValues([
          [
            "Chưa có đơn",
            addr.recipient_name || "",
            addr.phone ? ("'" + addr.phone) : "",
            addr.address || "",
            "",
            "Không có đơn hàng",
            "",
            "",
            "",
            nowStr
          ]
        ]);
        applyCellStyle(statusCell, STATUS_STYLES.DEFAULT, false);
        continue;
      }

      var order = orders[0];
      var mvd = order.ma_van_don || (order.ma_kien_hang ? ("Kiện: " + order.ma_kien_hang) : "Chưa có MVĐ");
      var tenNguoiNhan = order.ten_nguoi_nhan || "";
      var sdt = order.so_dien_thoai ? ("'" + order.so_dien_thoai) : "";
      var diaChi = order.dia_chi || "";
      var tienCod = order.tien_cod_vnd || "";

      var trangThaiParts = [];
      if (order.order_status_title) trangThaiParts.push(order.order_status_title);
      if (order.order_status_detail) trangThaiParts.push(order.order_status_detail);
      var trangThai = trangThaiParts.join(" - ");

      var timeline = order.hanh_trinh_don_hang || [];
      var hanhTrinhCuoi = "";
      if (timeline.length > 0) {
        var latest = timeline[0];
        var parts = [];
        if (latest.thoi_gian) parts.push("[" + latest.thoi_gian + "]");
        if (latest.trang_thai) parts.push(latest.trang_thai);
        if (latest.mo_ta) parts.push(String(latest.mo_ta).replace(/\n/g, " "));
        if (latest.sdt_buu_ta) {
          parts.push("(Shipper: " + (latest.buu_ta || "") + " " + latest.sdt_buu_ta + ")");
        }
        hanhTrinhCuoi = parts.join(" ");
      }

      var thoiGianDat = order.ngay_gio_dat_don ? ("'" + order.ngay_gio_dat_don) : "";
      var tenSanPham = (order.ten_san_pham || "") + " (x" + (order.so_luong || 1) + ")";

      sheet.getRange(rowIndex, 2, 1, 10).setValues([
        [
          "'" + mvd,
          tenNguoiNhan,
          sdt,
          diaChi,
          tienCod,
          trangThai,
          hanhTrinhCuoi,
          thoiGianDat,
          tenSanPham,
          nowStr
        ]
      ]);

      var style = classifyOrderStatusStyle(order, trangThai, hanhTrinhCuoi);
      applyCellStyle(statusCell, style, true);

      Utilities.sleep(300);
    } catch (err) {
      sheet.getRange(rowIndex, 2, 1, 10).setValues([
        ["", "", "", "", "", "Exception: " + err.message, "", "", "", nowStr]
      ]);
      applyCellStyle(statusCell, STATUS_STYLES.CANCELLED, true);
    }
  }
}

function clearExistingTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkAllTikTokOrders") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function enable15MinTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 15 phút!");
}

function enable30MinTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 30 phút!");
}

function enableHourlyTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 1 tiếng!");
}

function disableTriggers() {
  clearExistingTriggers();
  SpreadsheetApp.getUi().alert("🛑 Đã tắt tự động kiểm tra.");
}
