const OEC_BASE_URL = "https://oec-api.tiktokv.com";
const API16_BASE_URL = "https://api16-normal-c-alisg.tiktokv.com";
const COMMON_QUERY =
  "aid=1180&app_name=trill&version_code=470702&version_name=47.7.2" +
  "&device_platform=android&os=android&region=VN&sys_region=VN&current_region=VN&priority_region=VN&store_region=VN&carrier_region=VN" +
  "&app_language=vi&language=vi&locale=vi-VN&sys_language=vi&tz_name=Asia%2FHo_Chi_Minh&tz_offset=25200";
const DEFAULT_UA =
  "com.ss.android.ugc.trill/470702 (Linux; U; Android 13; vi_VN; Pixel 7; " +
  "Build/TD1A.220804.031; Cronet/TTNetVersion:c882992c 2024-09-01 QuicVersion:f29a1353 2024-08-20)";
const USD_TO_VND_RATE = 25400;

const ORDER_STATUS_VI_MAP = {
  1: "Chờ thanh toán",
  2: "Chờ vận chuyển",
  3: "Đang giao hàng",
  4: "Đã giao",
  5: "Đã giao",
  6: "Chờ đánh giá",
  8: "Trả hàng / Hoàn tiền",
  100: "Chờ thanh toán",
  200: "Chờ vận chuyển",
  300: "Đang giao hàng",
  500: "Đã giao",
};

function normalizeViText(str) {
  if (!str) return "";
  return String(str)
    .replace(/Người nhận:\s*Customer\b/gi, "Người nhận: Khách hàng")
    .replace(/Recipient:\s*Customer\b/gi, "Người nhận: Khách hàng")
    .replace(/^Delivered$/i, "Đã giao")
    .replace(/^In transit$/i, "Đang trung chuyển")
    .replace(/^Out for delivery$/i, "Trên đường giao")
    .replace(/^Order placed$/i, "Đã đặt đơn hàng")
    .replace(/^Completed$/i, "Hoàn thành")
    .replace(/^Cancell?ed$/i, "Đã hủy");
}

function resolveStatusVi(orderStatusCode, pkgStatus) {
  if (pkgStatus && ORDER_STATUS_VI_MAP[pkgStatus]) {
    return ORDER_STATUS_VI_MAP[pkgStatus];
  }
  if (orderStatusCode != null && ORDER_STATUS_VI_MAP[orderStatusCode]) {
    return ORDER_STATUS_VI_MAP[orderStatusCode];
  }
  return "";
}

function formatTs(tsVal) {
  if (!tsVal) return "";
  let num = Number(tsVal);
  if (!Number.isFinite(num) || num <= 0) return String(tsVal);
  if (num < 1e11) num *= 1000;
  const d = new Date(num + 7 * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function buildHeaders(sessionid) {
  const clean = sessionid.trim();
  const cookieStr = clean.includes("sessionid=")
    ? clean
    : `sessionid=${clean}; sid_tt=${clean}`;
  return {
    Cookie: cookieStr,
    "User-Agent": DEFAULT_UA,
    "Content-Type": "application/json",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "x-tt-locale": "vi-VN",
    "oec-locale": "vi-VN",
    "x-tt-store-region": "vn",
    "x-tt-store-region-src": "uid",
    "x-tt-oec-opaque-enable": "1",
    "oec-cs-si-a": "2",
    "oec-cs-si-b": "1",
    "sdk-version": "2",
  };
}

function parseShippingAddress(addrEntry) {
  const shippingAddr = addrEntry?.shipping_address || {};
  const items = {};
  for (const x of shippingAddr.items || []) {
    items[x.key] = x.value || "";
  }
  const districts = (shippingAddr.districts || [])
    .map((d) => d.name)
    .filter(Boolean);
  const regionName = shippingAddr.region?.name || "";

  const parts = [];
  if (items.address_detail) parts.push(items.address_detail);
  if (items.address) parts.push(items.address);
  for (const dist of [...districts].reverse()) {
    if (!parts.includes(dist)) parts.push(dist);
  }
  if (regionName && !parts.includes(regionName)) parts.push(regionName);

  return {
    address_id: shippingAddr.id,
    recipient_name: items.name || "",
    phone: items.plain_phone || items.phone || "",
    masked_phone: items.phone || "",
    address: parts.join(", "),
    is_default: items.default === "1",
    available_for_order: addrEntry?.available_for_change,
  };
}

async function fetchOrderLogisticsAndProducts(oid, headers, fallbackCard, createTime) {
  const products = [];
  let pkgId = "";
  let trackingNo = "";
  let providerName = "";
  let logisticsFromText = "";
  let packageStatus = "";
  let etaMin = null;
  let etaMax = null;
  let shipperName = "";
  let shipperPhone = "";
  let timeline = [];

  try {
    const pkgUrl = `${OEC_BASE_URL}/api/v1/shop/logistics_package_list/get?${COMMON_QUERY}`;
    const pkgRes = await fetch(pkgUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ main_order_id: oid }),
    });
    const pkgJson = await pkgRes.json();
    const pkgItems = pkgJson.data?.package_items || [];
    if (pkgItems.length > 0) {
      const firstPkg = pkgItems[0];
      pkgId = firstPkg.package_id || "";
      const logCard = firstPkg.logistics_card || {};
      if (logCard.pkg_main_status) {
        packageStatus = String(logCard.pkg_main_status);
      }
      const detailItem = logCard.detail_item || {};
      if (detailItem.title || detailItem.description) {
        timeline.push({
          thoi_gian: formatTs(detailItem.time),
          trang_thai: normalizeViText(detailItem.title || ""),
          mo_ta: normalizeViText(detailItem.description || ""),
          dia_diem: detailItem.address || "",
        });
      }
    }
  } catch (_) {}

  try {
    const qPkg = pkgId ? `&pkg_id=${pkgId}` : "";
    const ldUrl = `${OEC_BASE_URL}/api/v1/shop/logistics_detail/get?main_order_id=${oid}${qPkg}&type=1&api_version=5&${COMMON_QUERY}`;
    const ldRes = await fetch(ldUrl, { method: "GET", headers });
    const ldJson = await ldRes.json();
    let ldData = ldJson.data || {};
    let logDetail = ldData.logistics_detail || ldData.logistics_details || {};

    if (!pkgId && logDetail.pkg_id) {
      pkgId = logDetail.pkg_id;
      const ldUrl2 = `${OEC_BASE_URL}/api/v1/shop/logistics_detail/get?main_order_id=${oid}&pkg_id=${pkgId}&type=1&api_version=5&${COMMON_QUERY}`;
      const ldRes2 = await fetch(ldUrl2, { method: "GET", headers });
      const ldJson2 = await ldRes2.json();
      if (ldJson2.code === 0 && ldJson2.data) {
        ldData = ldJson2.data;
        logDetail = ldData.logistics_detail || ldData.logistics_details || logDetail;
      }
    }

    for (const oi of ldData.card?.order_info_list || []) {
      for (const pi of oi.product_info_list || []) {
        const urls = pi.sku_cover?.url_list || [];
        products.push({
          product_id: pi.product_id || "",
          sku_id: pi.sku_id || "",
          product_title: pi.product_title || "",
          count: pi.count || 1,
          product_image: urls[0] || "",
        });
      }
    }

    const providerInfo = ldData.provider_info || {};
    pkgId = logDetail.pkg_id || ldData.meta_info?.pkg_id || pkgId;
    trackingNo =
      logDetail.tracking_no || providerInfo.tracking_no || logDetail.track_no || "";
    providerName =
      logDetail.provider_name ||
      providerInfo.provider_name ||
      providerInfo.logistics_service_name ||
      "";
    logisticsFromText =
      logDetail.logistics_from_text || providerInfo.provider_text || "";
    etaMin = logDetail.eta_time_min;
    etaMax = logDetail.eta_time_max;

    const buriedStatus = ldData.buried_data?.order_status?.order_status_name;
    if (buriedStatus && !packageStatus) {
      packageStatus = buriedStatus;
    }

    const newestCourier =
      logDetail.newest_courier_info ||
      ldData.logistics_details?.newest_courier_info ||
      {};
    shipperName = newestCourier.courier_name || "";
    shipperPhone = newestCourier.courier_phone || newestCourier.whatsapp_num || "";

    const rawItems =
      logDetail.logistics_detail_items ||
      ldData.logistics_details?.logistics_detail_items ||
      logDetail.nodes ||
      [];
    if (rawItems.length > 0) {
      timeline = rawItems.map((item) => {
        const cName = item.courier_info?.courier_name || "";
        const cPhone =
          item.courier_info?.courier_phone || item.courier_info?.whatsapp_num || "";
        if (cName && !shipperName) shipperName = cName;
        if (cPhone && !shipperPhone) shipperPhone = cPhone;
        return {
          thoi_gian: formatTs(item.time),
          timestamp: item.time,
          trang_thai: normalizeViText(item.title || ""),
          mo_ta: normalizeViText(item.description || ""),
          dia_diem: item.address || "",
          buu_ta: cName,
          sdt_buu_ta: cPhone,
        };
      });
    }
  } catch (_) {}

  if (timeline.length === 0) {
    timeline.push({
      thoi_gian: formatTs(createTime),
      timestamp: createTime,
      trang_thai: normalizeViText(fallbackCard.title) || "Đã đặt đơn hàng",
      mo_ta: normalizeViText(fallbackCard.status_text || ""),
      dia_diem: "",
    });
  }

  let etaDelivery = null;
  if (etaMin && etaMax) {
    etaDelivery = `${formatTs(etaMin).slice(0, 10)} -> ${formatTs(etaMax).slice(0, 10)}`;
  }

  return {
    products,
    pkg_id: pkgId,
    tracking_no: trackingNo || null,
    provider_name: providerName || logisticsFromText.trim() || null,
    package_status: packageStatus,
    eta_delivery: etaDelivery,
    shipper_name: shipperName || null,
    shipper_phone: shipperPhone || null,
    timeline,
  };
}

async function checkTikTokOrders(sessionid) {
  const headers = buildHeaders(sessionid);

  const ocUrl = `${OEC_BASE_URL}/api/v1/trade/bff/order_center/get?${COMMON_QUERY}`;
  const ocRes = await fetch(ocUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fe_version: "1",
      previous_page: "navigation_panel",
      request_type: "init_data",
    }),
  });
  const ocJson = await ocRes.json();
  if (ocJson.code !== 0) {
    return {
      success: false,
      error_code: ocJson.code,
      message: ocJson.message || "Cookie sessionid không hợp lệ hoặc đã hết hạn",
    };
  }

  const sections = ocJson.data?.data || [];
  const globalData = ocJson.data?.global || {};
  const tabCounts = {};
  const orderCards = {};

  for (const sec of sections) {
    if (sec.features?.id === "uuid_order_tool") {
      const viewData = sec.render_data?.view_data || {};
      for (const tool of viewData.tool_list || []) {
        const redText = tool.red_dot?.text;
        tabCounts[tool.key] = redText && /^\d+$/.test(redText) ? Number(redText) : 0;
      }
      for (const card of viewData.order_card_list || []) {
        const oid = card.main_order_id;
        const subtitleText = (card.subtitle?.elements || [])
          .map((e) => e.text)
          .filter(Boolean)
          .join(" ");
        orderCards[oid] = {
          title: card.title || "",
          status_text: subtitleText,
          product_image: card.product_cover?.url || "",
        };
      }
    }
  }

  const recommendOrders = [...(globalData.recommend_info?.orders || [])];
  const seenOrderIds = new Set(recommendOrders.map((o) => o.order_id));
  for (const oid of Object.keys(orderCards)) {
    if (oid && !seenOrderIds.has(oid)) {
      recommendOrders.unshift({ order_id: oid, create_time: "", order_status: 0, amount: "0", sub_orders: [] });
      seenOrderIds.add(oid);
    }
  }

  const codByTracking = {};
  try {
    const noticeUrl = `${API16_BASE_URL}/aweme/v1/notice/list/message/?notice_group=210&count=30&max_time=0&min_time=0&${COMMON_QUERY}`;
    const noticeRes = await fetch(noticeUrl, { method: "GET", headers });
    const noticeJson = await noticeRes.json();
    const noticeList = noticeJson.messages?.notice?.notice_list || [];
    for (const n of noticeList) {
      const content = n.template_notice?.notice?.content || "";
      if (content.includes("thanh toán ") && content.includes(" để nhận kiện hàng ")) {
        const codPart = content.split("thanh toán ")[1]?.split(" để nhận kiện hàng ")[0]?.trim();
        const trkPart = content.split(" để nhận kiện hàng ")[1]?.split(" ")[0]?.trim();
        if (codPart && trkPart) codByTracking[trkPart] = codPart;
      }
    }
  } catch (_) {}

  let defaultAddresses = [];
  try {
    const addrUrl = `${OEC_BASE_URL}/api/v1/shop/shipping_address/get?${COMMON_QUERY}`;
    const addrRes = await fetch(addrUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const addrJson = await addrRes.json();
    defaultAddresses = (addrJson.data?.shipping_address_list || []).map(parseShippingAddress);
  } catch (_) {}

  const ordersResult = [];
  for (const rec of recommendOrders) {
    const oid = rec.order_id;
    const amountUsd = parseFloat(rec.amount || "0") || 0;
    const estimatedVnd = Math.round((amountUsd * USD_TO_VND_RATE) / 100) * 100;

    let orderRecipient = defaultAddresses[0] || null;
    try {
      const addrUrl = `${OEC_BASE_URL}/api/v1/shop/shipping_address/get?${COMMON_QUERY}`;
      const addrRes = await fetch(addrUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          change_addr_order_id: oid,
          change_addr_order_type: 2,
        }),
      });
      const addrJson = await addrRes.json();
      const parsed = (addrJson.data?.shipping_address_list || []).map(parseShippingAddress);
      orderRecipient = parsed.find((a) => a.available_for_order) || parsed[0] || orderRecipient;
    } catch (_) {}

    const cardInfo = orderCards[oid] || {};
    const firstSub = (rec.sub_orders || [])[0] || {};
    const productGid = firstSub.gid || "";

    const logInfo = await fetchOrderLogisticsAndProducts(
      oid,
      headers,
      cardInfo,
      rec.create_time
    );
    const prodList = logInfo.products;
    const firstProd = prodList[0] || {};
    const fullProductTitle =
      prodList
        .filter((p) => p.product_title)
        .map((p) => (p.count > 1 ? `${p.product_title} (x${p.count})` : p.product_title))
        .join(", ") || (productGid ? `Sản phẩm #${productGid}` : "Sản phẩm TikTok Shop");

    const latestStep = logInfo.timeline[0] || {};
    const trkNo = logInfo.tracking_no;
    const exactCodVnd = trkNo ? codByTracking[trkNo] : null;
    const statusTitleVi =
      normalizeViText(cardInfo.title) ||
      normalizeViText(latestStep.trang_thai) ||
      resolveStatusVi(rec.order_status, logInfo.package_status);
    const statusDetailVi = normalizeViText(cardInfo.status_text || latestStep.mo_ta || "");

    ordersResult.push({
      order_id: oid,
      ngay_gio_dat_don: formatTs(rec.create_time),
      create_timestamp: rec.create_time,
      order_status_code: rec.order_status,
      order_status_name: logInfo.package_status || statusTitleVi || "",
      order_status_title: statusTitleVi,
      order_status_detail: statusDetailVi,
      trang_thai_don_hang: statusTitleVi,
      chi_tiet_trang_thai: statusDetailVi,
      ten_san_pham: fullProductTitle,
      so_luong: prodList.length > 0 ? prodList.reduce((s, p) => s + (p.count || 1), 0) : 1,
      product_id: firstProd.product_id || productGid,
      sku_id: firstProd.sku_id || "",
      seller_id: firstSub.seller_id || "",
      product_image: firstProd.product_image || cardInfo.product_image || "",
      ten_nguoi_nhan: orderRecipient?.recipient_name || "",
      dia_chi: orderRecipient?.address || "",
      so_dien_thoai: orderRecipient?.phone || "",
      tien_cod_usd: amountUsd,
      tien_cod_vnd: exactCodVnd || `${estimatedVnd.toLocaleString("vi-VN")} VND`,
      ma_van_don: trkNo,
      ma_kien_hang: logInfo.pkg_id,
      don_vi_van_chuyen: logInfo.provider_name,
      ten_shipper: logInfo.shipper_name,
      sdt_shipper: logInfo.shipper_phone,
      ngay_giao_du_kien: logInfo.eta_delivery,
      hanh_trinh_don_hang: logInfo.timeline,
    });
  }

  return {
    success: true,
    has_orders: ordersResult.length > 0 || Object.values(tabCounts).some((v) => v > 0),
    tab_summary: tabCounts,
    thong_ke_tab_vi: {
      cho_thanh_toan: tabCounts.unpaid || 0,
      cho_van_chuyen: tabCounts.to_ship || 0,
      cho_nhan: tabCounts.shipped || 0,
      cho_danh_gia: tabCounts.to_review || 0,
      tra_hang: tabCounts.returns || 0,
    },
    orders: ordersResult,
    address_book: defaultAddresses,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let sessionid = "";
  if (req.method === "GET") {
    sessionid = req.query?.sessionid || "";
  } else if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    sessionid = body.sessionid || "";
  } else {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  if (!sessionid) {
    return res.status(400).json({
      success: false,
      error: "Missing sessionid parameter",
    });
  }

  try {
    const data = await checkTikTokOrders(sessionid);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

