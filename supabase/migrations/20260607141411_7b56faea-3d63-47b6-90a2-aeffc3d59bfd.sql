CREATE TABLE public.api_coverage (
  code text PRIMARY KEY,
  module text NOT NULL,
  name text NOT NULL,
  http_method text NOT NULL,
  path text NOT NULL,
  params text,
  backend_fn text,
  ui_page text,
  validation text,
  dangerous boolean NOT NULL DEFAULT false,
  mock_supported boolean NOT NULL DEFAULT true,
  mock_test_status text NOT NULL DEFAULT 'pending',
  live_test_status text NOT NULL DEFAULT 'pending',
  live_result jsonb,
  last_error text,
  proof jsonb,
  seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_coverage TO authenticated;
GRANT ALL ON public.api_coverage TO service_role;

ALTER TABLE public.api_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read api_coverage"
ON public.api_coverage FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_api_coverage_updated
BEFORE UPDATE ON public.api_coverage
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.api_coverage (code, module, name, http_method, path, params, backend_fn, ui_page, dangerous, seq) VALUES
('A1','AUTH','OAuth2 Login','POST','/oauth2/login','query: username, password(SHA256)','oauth2Login','/admin/api-health',false,1),
('O1','LOCATION','Get Device Info','GET','/rent/cabinet/query','query: deviceId','cabinetQuery','/admin/stations',false,2),
('O2','LOCATION','Create Rent Order','POST','/rent/order/create','query: deviceId, callbackURL','orderCreate','/kiosk',false,3),
('O3','LOCATION','Query Rent Order Status','POST','/rent/order/query','query: tradeNo','orderQuery','/admin/orders',false,4),
('O4','LOCATION','Mark Order Completed','POST','/rent/order/close','query: tradeNo','orderClose','/admin/orders',false,5),
('O5','LOCATION','Get Order Detail','GET','/rent/order/detail','query: tradeNo','orderDetail','/admin/orders',false,6),
('O6','LOCATION','Get Device List (geo)','POST','/rent/cabinet/list','query: coordType, zoomLevel, lat, lng, showPrice','cabinetListGeo','/admin/stations',false,7),
('O7','LOCATION','Get Device Info (POST variant)','POST','/rent/cabinet/query','query: deviceId','cabinetQueryPost','/admin/stations',false,8),
('C1','CABINET','Device Operation','POST','/cabinet/operation','query: cabinetid, slotNum, operationType, reason','cabinetOperation','/admin/maintenance',true,9),
('C2','CABINET','Eject By Repair','POST','/cabinet/ejectByRepair','query: cabinetid, slotNum','ejectByRepair','/admin/maintenance',true,10),
('C3','CABINET','Eject By Rent','POST','/cabinet/ejectByRent','query: cabinetid, rentOrderId, slotNum','ejectByRent','/admin/maintenance',true,11),
('C4','CABINET','Cabinet Detail','GET','/cabinet/detail/{cabinetId}','path: cabinetId','cabinetDetail','/admin/stations',false,12),
('C5','CABINET','Devices By Shop','GET','/cabinet/getDeviceByShopId','query: shopid','getDeviceByShopId','/admin/stations',false,13),
('C6','CABINET','All Devices Paged','GET','/cabinet/getAllDevicePage','query: page, limit','getAllDevicePage','/admin/stations',false,14),
('C7','CABINET','Battery List By Cabinet','GET','/cabinet/batteryListByCabinetId/{cabinetId}','path: cabinetId','batteryListByCabinetId','/admin/stations',false,15),
('C8','CABINET','Slot List By Cabinet','GET','/cabinet/slotByCabinetId/{cabinetId}','path: cabinetId','slotByCabinetId','/admin/stations',false,16),
('C9','CABINET','Bind Device To Shop','POST','/cabinet/bind2shop/{qrcode}/{newshopid}','path: qrcode, newshopid','bind2shop','/admin/stations',true,17),
('C10','CABINET','Update Cabinet Advertising','POST','/cabinet/bindAd','body: cabinetIdList, isRestart, adConfigList','bindAd','/admin/advertising',true,18),
('C11','CABINET','Unbind Device From Shop','POST','/cabinet/unbindShop','body: [deviceId]','unbindShop','/admin/stations',true,19),
('C12','CABINET','Publish Advertisement','POST','/cabinet/publishAd','body: cabinetIdList, restart, adConfigList','publishAd','/admin/advertising',true,20),
('S1','SHOP','Get All Shop List','GET','/shop/getShopList','-','getShopList','/admin/shops',false,21),
('S2','SHOP','Get Shop Detail','GET','/shop/detail/{shopid}','path: shopid','shopDetail','/admin/shops',false,22),
('S3','SHOP','Create New Shop','POST','/shop/create','body: pNewid, pName, pJingdu, pWeidu, ...','shopCreate','/admin/shops',false,23),
('S4','SHOP','Update Shop','PUT','/shop/update','body: shop fields','shopUpdate','/admin/shops',false,24),
('S5','SHOP','Delete Shop','DELETE','/shop/delete/{shopid}','path: shopid','shopDelete','/admin/shops',true,25),
('P1','PRICING','Get Price Strategy Page','POST','/shop/priceStrategy/page','body: size, current, shopId, priceId, name','priceStrategyPage','/admin/pricing',false,26),
('P2','PRICING','Get Price Strategy Detail','GET','/shop/priceStrategy/detail/{priceId}','path: priceId','priceStrategyDetail','/admin/pricing',false,27),
('P3','PRICING','Create Or Update Price Strategy','POST','/shop/priceStrategy/saveOrUpdate','body: priceId, name, shopId, priceStrategyDetailList[]','priceStrategySave','/admin/pricing',false,28),
('P4','PRICING','Delete Price Strategy','POST','/shop/priceStrategy/delete','body: [priceId]','priceStrategyDelete','/admin/pricing',true,29),
('P5','PRICING','Shop Bind Price Strategy','POST','/shop/priceStrategy/bindShop','body: shopId, priceId, customType','priceStrategyBind','/admin/pricing',false,30),
('P6','PRICING','Shop Unbind Price Strategy','POST','/shop/priceStrategy/unbindShop','body: shopId, customType','priceStrategyUnbind','/admin/pricing',false,31),
('R1','ORDERS','Order List','GET','/order/list','query: filters','orderList','/admin/orders',false,32),
('E1','EVENTS','Cabinet Event Push Config','POST','/cabinet/eventPush/config','body: pushUrl, eventSubscriptions[]','eventPushConfig','/admin/events',true,33),
('E2','EVENTS','Get Cabinet Event Push Config','GET','/cabinet/eventPush/config/get','-','eventPushConfigGet','/admin/events',false,34),
('E3','EVENTS','Cabinet Event Push Receiver','POST','(self) /functions/v1/cabinet-event-push','body: agentAccount, event, eventData, timestamp','cabinet-event-push','/admin/events',false,35);