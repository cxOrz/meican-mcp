// Response summarizers: turn raw Meican JSON into compact shapes friendly
// to agent context windows. snake_case keys at the top level, since the
// LLM-facing tool API is snake_case.

type RawMeicanObject = Record<string, any>;

function fmtCST(ms: number | string | null | undefined): string | null {
  if (ms == null) return null;
  const d = new Date(Number(ms) + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function makeTargetTime(date: string, closeTime: string): string {
  return `${date} ${closeTime}`;
}

export function summarizeCalendarItem(ci: RawMeicanObject, date: string) {
  const closeTime = ci.openingTime?.closeTime;
  const targetTime = closeTime ? makeTargetTime(date, closeTime) : null;
  const cou = ci.corpOrderUser;
  const result: RawMeicanObject = {
    tab_unique_id: ci.userTab?.uniqueId,
    title: ci.title,
    organization_name: ci.userTab?.corp?.name,
    organization_namespace: ci.userTab?.corp?.namespace,
    status: ci.status, // AVAILABLE | ORDER | ...
    reason: ci.reason || undefined,
    open_time: ci.openingTime?.openTime,
    close_time: closeTime,
    postbox_open_time: ci.openingTime?.postboxOpenTime,
    target_time_server: fmtCST(ci.targetTime),
    target_time: targetTime,
    existing_order: null,
  };
  if (cou) {
    const dishes: Array<{
      dish_id?: number;
      name?: string;
      count?: number;
      price_in_cent?: number;
      restaurant_unique_id?: string;
    }> = [];
    for (const r of cou.restaurantItemList || []) {
      for (const di of r.dishItemList || []) {
        dishes.push({
          dish_id: di.dish?.id,
          name: di.dish?.name,
          count: di.count,
          price_in_cent: di.dish?.priceInCent,
          restaurant_unique_id: r.uniqueId,
        });
      }
    }
    result.existing_order = {
      unique_id: cou.uniqueId,
      status: cou.corpOrderStatus,
      pay_status: cou.payStatus,
      ready_to_delete: cou.readyToDelete,
      total_price_in_cent: dishes.reduce((s, d) => s + (d.price_in_cent || 0) * (d.count || 1), 0),
      dishes,
    };
  }
  return result;
}

export function summarizeCalendar(resp: RawMeicanObject) {
  return {
    dates: (resp.dateList || []).map((d: RawMeicanObject) => ({
      date: d.date,
      tabs: (d.calendarItemList || []).map((ci: RawMeicanObject) => summarizeCalendarItem(ci, d.date)),
    })),
  };
}

export function summarizeRestaurants(resp: RawMeicanObject) {
  return {
    target_time: resp.targetTime,
    restaurants: (resp.restaurantList || []).map((r: RawMeicanObject) => ({
      unique_id: r.uniqueId,
      name: r.name,
      open: r.open,
      rating: r.rating,
      available_dish_count: r.availableDishCount,
      remark_enabled: r.remarkEnabled,
      online_payment: r.onlinePayment,
      tel: r.tel,
      warning: r.warning || undefined,
    })),
  };
}

export function summarizeMenu(resp: RawMeicanObject) {
  const dishesById = new Map();
  for (const d of resp.dishList || []) dishesById.set(d.id, d);
  const sections = (resp.sectionList || []).map((s: RawMeicanObject) => ({
    section_id: s.id,
    name: s.name,
    dishes: (s.dishIdList || []).map((id: number) => {
      const d = dishesById.get(id) || {};
      return {
        dish_id: d.id ?? id,
        name: d.name,
        price_in_cent: d.priceInCent,
        price_string: d.priceString,
        original_price_in_cent: d.originalPriceInCent,
      };
    }),
  }));
  const referenced = new Set(sections.flatMap((s: RawMeicanObject) => s.dishes.map((d: RawMeicanObject) => d.dish_id)));
  const orphans = (resp.dishList || [])
    .filter((d: RawMeicanObject) => !d.isSection && !referenced.has(d.id))
    .map((d: RawMeicanObject) => ({
      dish_id: d.id,
      name: d.name,
      price_in_cent: d.priceInCent,
      price_string: d.priceString,
    }));
  return {
    restaurant_unique_id: resp.uniqueId,
    name: resp.name,
    open: resp.open,
    rating: resp.rating,
    target_time: resp.targetTime,
    remark_enabled: resp.remarkEnabled,
    sections,
    unsectioned: orphans.length ? orphans : undefined,
  };
}

export function summarizeAddresses(resp: RawMeicanObject) {
  const data = resp.data || resp;
  return {
    addresses: (data.addressList || []).map((a: RawMeicanObject) => ({
      unique_id: a.finalValue?.uniqueId,
      pick_up_location: a.finalValue?.pickUpLocation || a.name,
    })),
    recent: (data.recentList || []).map((r: RawMeicanObject) => ({
      unique_id: r.uniqueId,
      pick_up_location: r.pickUpLocation || r.address,
      last_used_time: r.lastUsedTime,
    })),
    use_organization_address_remark: data.useCorpAddressRemark,
    use_multi_organization_address: data.useMultiCorpAddress,
  };
}

export function summarizeOrderShow(resp: RawMeicanObject, groupMeal: RawMeicanObject) {
  const d = resp.data || {};
  const o = groupMeal?.data?.order;
  return {
    unique_id: d.uniqueId,
    title: d.title,
    target_time: fmtCST(d.targetTime),
    closet_open_time: d.closetOpenTime,
    status_info: d.statusInfo,
    pay_status: d.payStatus,
    total_price_in_cent: d.totalPriceInCent,
    pick_up_location: d.pickUpLocation,
    pick_up_location_code: d.pickUpLocationCode,
    real_name: d.realName,
    warning: d.warning?.text,
    group_meal_status: o?.groupOrderStatus,
    order_meal_time: o?.orderMealTime ? fmtCST(Number(o.orderMealTime)) : undefined,
    order_close_time: o?.orderCloseTime ? fmtCST(Number(o.orderCloseTime)) : undefined,
    dishes: [
      ...(d.orderDishInBoxList || []),
      ...(d.orderDishWithClosetInfoList || []),
      ...(d.orderDishOverflow || []),
    ].map((x: RawMeicanObject) => ({
      dish_id: x.id,
      name: x.name,
      restaurant_unique_id: x.restaurantUniqueId,
      restaurant_name: x.restaurantName,
      price_in_cent: x.priceInCent,
      user_received: x.userReceived,
    })),
  };
}

export function summarizeOrdersAdd(resp: RawMeicanObject) {
  const o = resp.order || {};
  return {
    status: resp.status,
    message: resp.message || undefined,
    unique_id: o.uniqueId,
    payment_slip_id: o.paymentSlipId,
    pay_status: o.legacyPayStatus?.payStatus,
    monopoly_payment_version: o.legacyPayStatus?.monopolyPaymentVersion,
  };
}

export function pickSuggestedAddress(addrResp: RawMeicanObject) {
  const rec = addrResp.data?.recentList?.[0];
  return rec ? { unique_id: rec.uniqueId, pick_up_location: rec.pickUpLocation } : null;
}
