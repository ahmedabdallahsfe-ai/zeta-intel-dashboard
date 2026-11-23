/* ==========================================================================
 * iqvia-card-info.js  (2026-11-23, Ahmed)
 * Market Intelligence (IQVIA tab): adds an "i" icon to every KPI card, chart
 * and table title. Hover or click it to see what the card means, in English
 * and Arabic. Definitions follow the formulas actually used in js/iqvia.js
 * (EVI, HHI, CR5, BCG RMS >= 0.5, growth eligibility rule, forecast models).
 *
 * Add-on only: js/iqvia.js is NOT modified. A MutationObserver on #app-root
 * decorates titles after each render, only while the IQVIA tab is active.
 * Titles with no definition get no icon (see window.__IQCI_MISSING).
 * To add / edit a definition: edit the K (KPI), C (chart) or T (table) list.
 * Each entry: [regex on the normalised title, English, Arabic, optional test].
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__IQCI_LOADED) return; window.__IQCI_LOADED = true;

  var UNIT_EN = ' Unit = the one selected in the top bar (LCV = value in EGP at IQVIA pharmacy price, SU = standard units, Packs).';
  var UNIT_AR = ' الوحدة = المختارة في الشريط العلوي (LCV = القيمة بالجنيه بسعر الصيدلية حسب IQVIA، SU = الوحدات المعيارية، Packs = العبوات).';
  function subHas(re) { return function (ctx) { return re.test(ctx.sub); }; }
  function inSec(id) { return function (ctx) { return !!(ctx.el.closest && ctx.el.closest('#' + id)); }; }

  /* ---------------- KPI cards ---------------- */
  var K = [
    [/^products tracked/, 'Number of Zeta products in the 2026 target market-share list for the current filters. The sub-line shows how many have a target share set.', 'عدد منتجات زيتا المدرجة في قائمة أهداف الحصة السوقية لعام 2026 حسب الفلاتر الحالية. السطر الفرعي يوضح عدد المنتجات التي لها حصة مستهدفة محددة.'],
    [/^on ?\/ ?above target/, 'Products whose actual share in their DM1 market reached 100% or more of the target share.', 'المنتجات التي وصلت حصتها الفعلية في سوق DM1 الخاص بها إلى 100% أو أكثر من الحصة المستهدفة.'],
    [/^near target/, 'Products achieving 80–99% of their target share: close to target, they need follow-up to close the gap.', 'المنتجات التي تحقق من 80% إلى 99% من الحصة المستهدفة: قريبة من الهدف وتحتاج متابعة لسد الفجوة.'],
    [/^below target/, 'Products achieving less than 80% of their target share: they need a corrective action plan.', 'المنتجات التي تحقق أقل من 80% من الحصة المستهدفة، وتحتاج خطة عمل تصحيحية.'],
    [/^avg achievement/, 'Average achievement of measurable products. Achievement = actual market share ÷ target share × 100. Products without a target (TBD) are excluded.', 'متوسط نسبة التحقيق للمنتجات القابلة للقياس. نسبة التحقيق = الحصة الفعلية ÷ الحصة المستهدفة × 100، ويُستبعد ما ليس له هدف (TBD).'],

    [/^market size/, 'Total sales of the whole market (all companies) for the selected time range and filters.' + UNIT_EN, 'إجمالي مبيعات السوق بالكامل (كل الشركات) للفترة الزمنية والفلاتر المختارة.' + UNIT_AR],
    [/^market growth/, '% change in total market sales vs the same prior period (e.g. MAT vs prior MAT).', 'نسبة تغير إجمالي مبيعات السوق مقارنة بنفس الفترة السابقة (مثلاً MAT مقابل MAT السابق).'],
    [/^(total |active )?corporations( analyzed)?$/, 'Number of companies with sales in the selected market and period.', 'عدد الشركات التي لها مبيعات في السوق والفترة المختارة.'],
    [/^(total |active )?products$/, 'Number of products with sales in the current view (market or selected company) and period.', 'عدد المنتجات التي لها مبيعات في العرض الحالي (السوق أو الشركة المختارة) خلال الفترة.'],
    [/^leader .*share/, 'Market share of the #1 company in the current view. The sub-line names the leader.', 'الحصة السوقية للشركة رقم 1 في العرض الحالي، والسطر الفرعي يوضح اسمها.'],
    [/^market evolution index/, 'Market sales now ÷ market sales in the prior period × 100. 100 = flat, above 100 = growing, 110+ = accelerating, below 100 = declining.', 'مبيعات السوق الحالية ÷ مبيعات الفترة السابقة × 100. 100 = ثبات، أكثر من 100 = نمو، 110 فأكثر = نمو متسارع، أقل من 100 = انكماش.'],
    [/^cr5/, 'Combined market share of the top 5 companies. The higher it is, the more the market is controlled by a few players.', 'مجموع الحصة السوقية لأكبر 5 شركات. كلما ارتفع دلّ على سيطرة عدد قليل من الشركات على السوق.'],
    [/^(product )?hhi/, 'Herfindahl-Hirschman Index = sum of squared market shares (0–10,000). Below 1,000 = fragmented / competitive, 1,000–1,800 = moderate, above 1,800 = concentrated (a few players dominate).', 'مؤشر هيرفندال-هيرشمان = مجموع مربعات الحصص السوقية (من 0 إلى 10,000). أقل من 1,000 = سوق مفتت وتنافسي، من 1,000 إلى 1,800 = تركيز متوسط، أكثر من 1,800 = سوق مركّز تسيطر عليه شركات قليلة.'],
    [/^(top|#2|#3) product \(/, 'Best-selling product at this rank in the current view, with its sales and share.', 'المنتج الأعلى مبيعاً في هذا الترتيب ضمن العرض الحالي، مع مبيعاته وحصته.'],
    [/^alt\.? metric/, 'The same total measured in the other unit (value vs volume), so you can compare value and volume trends.', 'نفس الإجمالي مقاساً بالوحدة الأخرى (القيمة مقابل الحجم) للمقارنة بين اتجاه القيمة والحجم.'],

    [/^total (dm2 |atc4 )?market/, 'Total sales of the whole market (all companies) for the selected range and filters.' + UNIT_EN, 'إجمالي مبيعات السوق بالكامل (كل الشركات) للفترة والفلاتر المختارة.' + UNIT_AR],
    [/^market .*total$/, 'Total sales of the whole market (all companies) for the selected range and filters.', 'إجمالي مبيعات السوق بالكامل (كل الشركات) للفترة والفلاتر المختارة.'],
    [/^total lcv$/, 'Total value sales (LCV) of all markets in this view.', 'إجمالي مبيعات القيمة (LCV) لكل الأسواق في هذا العرض.'],
    [/^total /, 'Total sales of the selected company (Zeta by default) for the selected time range.' + UNIT_EN, 'إجمالي مبيعات الشركة المختارة (زيتا افتراضياً) للفترة الزمنية المختارة.' + UNIT_AR],
    [/^corp growth/, 'Growth of the selected company vs the same prior period.', 'نمو الشركة المختارة مقارنة بنفس الفترة السابقة.'],
    [/^volume evi/, 'Volume Evolution Index = (1 + company unit growth) ÷ (1 + market unit growth) × 100. Above 100 = gaining volume share; below 100 = losing it.', 'مؤشر التطور بالحجم = (1 + نمو وحدات الشركة) ÷ (1 + نمو وحدات السوق) × 100. أكثر من 100 = كسب حصة بالحجم، وأقل من 100 = فقدانها.'],
    [/^(evolution index|evi$|evi \()/, 'EVI = (1 + company growth) ÷ (1 + market growth) × 100. 100 = growing at market pace, above 100 = gaining share, below 100 = losing share. 110+ = outperforming, below 95 = underperforming. Not shown for new or low-base items.', 'مؤشر التطور EVI = (1 + نمو الشركة) ÷ (1 + نمو السوق) × 100. 100 = نمو بنفس سرعة السوق، أكثر من 100 = كسب حصة، أقل من 100 = فقدان حصة. 110 فأكثر = أداء متفوق، أقل من 95 = أداء ضعيف. لا يظهر للمنتجات الجديدة أو ذات القاعدة الصغيرة.'],
    [/^market share \(/, 'Company sales ÷ total market sales in the current filters. The badge shows the change in percentage points (pp) vs the prior period.', 'مبيعات الشركة ÷ إجمالي مبيعات السوق حسب الفلاتر الحالية. الشارة توضح التغير بالنقاط المئوية (pp) مقارنة بالفترة السابقة.'],
    [/^incremental/, 'Absolute change in sales: current period minus prior period, i.e. how much was added (+) or lost (−).', 'التغير المطلق في المبيعات: الفترة الحالية ناقص الفترة السابقة، أي مقدار ما أُضيف (+) أو فُقد (−).'],
    [/^mom growth/, 'Latest month vs the previous month. A short-term signal: monthly IQVIA data can be volatile.', 'آخر شهر مقارنة بالشهر السابق. مؤشر قصير المدى، وبيانات IQVIA الشهرية قد تكون متذبذبة.'],
    [/^value growth/, 'Growth in value (LCV) vs the same prior period.', 'النمو في القيمة (LCV) مقارنة بنفس الفترة السابقة.'],
    [/^volume growth/, 'Growth in volume (units) vs the same prior period.', 'النمو في الحجم (الوحدات) مقارنة بنفس الفترة السابقة.'],
    [/^price ?\/ ?mix/, 'Value growth minus volume growth, in percentage points. Above +2pp = growth driven by price or a richer mix; below −2pp = value growing slower than units (lower prices or a cheaper mix).', 'نمو القيمة ناقص نمو الحجم بالنقاط المئوية. أكثر من +2pp = النمو مدفوع بالسعر أو بمزيج منتجات أعلى سعراً، أقل من −2pp = القيمة تنمو أبطأ من الوحدات (أسعار أقل أو مزيج أرخص).'],
    [/^(lcv\/su ratio|avg price)/, 'Average value per standard unit = LCV ÷ SU (EGP per SU). Shows price positioning; compare it with competitors.', 'متوسط القيمة لكل وحدة معيارية = LCV ÷ SU (جنيه لكل وحدة). يوضح التموضع السعري ويُقارن بالمنافسين.'],
    [/^growth driver$/, 'Main source of growth: Pricing if the price/mix effect is above +3pp, Volume if below −3pp, otherwise Balanced.', 'المصدر الرئيسي للنمو: السعر إذا كان أثر السعر/المزيج أكبر من +3pp، والحجم إذا كان أقل من −3pp، وإلا فهو متوازن.'],
    [/^products growing/, 'Number of products with positive growth vs the prior period.', 'عدد المنتجات التي حققت نمواً موجباً مقارنة بالفترة السابقة.'],
    [/^products declining/, 'Number of products with negative growth vs the prior period.', 'عدد المنتجات التي انخفضت مبيعاتها مقارنة بالفترة السابقة.'],
    [/^top 3 (driver )?concentration/, 'Share of the total incremental sales that came from the top 3 products. High = growth depends on very few products.', 'نسبة الزيادة الإجمالية في المبيعات القادمة من أعلى 3 منتجات. ارتفاعها يعني أن النمو يعتمد على عدد قليل جداً من المنتجات.', subHas(/incremental/i)],
    [/^top 3 concentration/, 'Combined market share of the top 3 companies in this market.', 'مجموع الحصة السوقية لأكبر 3 شركات في هذا السوق.'],
    [/^top product share/, 'Share of the company sales that comes from its #1 product. High = dependence on one product (portfolio risk).', 'نسبة مبيعات الشركة القادمة من منتجها الأول. ارتفاعها يعني الاعتماد على منتج واحد (مخاطرة في المحفظة).'],
    [/^(evi )?outperformers/, 'Number of products with EVI ≥ 110, i.e. growing clearly faster than their market.', 'عدد المنتجات التي مؤشر تطورها EVI ≥ 110، أي تنمو بوضوح أسرع من سوقها.'],
    [/^underperformers/, 'Number of products with EVI below 90, i.e. growing clearly slower than their market and losing share.', 'عدد المنتجات التي مؤشر تطورها EVI أقل من 90، أي تنمو أبطأ بوضوح من سوقها وتفقد حصة.'],
    [/^zeta total share/, 'Zeta sales ÷ total sales of the markets in view. The sub-line shows in how many markets Zeta is present.', 'مبيعات زيتا ÷ إجمالي مبيعات الأسواق في العرض. السطر الفرعي يوضح عدد الأسواق التي تتواجد فيها زيتا.'],
    [/^fastest growing/, 'Highest growth among eligible markets: prior sales above 0, not a low-base jump, and a share of the filtered market at or above the minimum threshold.', 'أعلى نمو بين الأسواق المؤهلة: مبيعات سابقة أكبر من صفر، وليس قفزة من قاعدة صغيرة، وحصة من السوق المفلتر لا تقل عن الحد الأدنى.'],
    [/^new entrants/, 'Products with no sales in the prior comparison period. Their growth is undefined, so they are counted separately and not ranked.', 'المنتجات التي لم يكن لها مبيعات في فترة المقارنة السابقة. نموها غير قابل للحساب، لذا تُعد بشكل منفصل ولا تدخل الترتيب.'],
    [/^fragmented markets/, 'Number of ATC4 markets with HHI below 0.15 (0–1 scale): many competitors and no dominant player, so they are easier to enter and win share.', 'عدد أسواق ATC4 التي مؤشر HHI فيها أقل من 0.15 (على مقياس 0–1): منافسون كثيرون بدون شركة مسيطرة، لذا يسهل دخولها وكسب حصة.'],
    [/^active markets/, 'Number of markets with sales in this view.', 'عدد الأسواق التي لها مبيعات في هذا العرض.'],
    [/^top market share/, 'The largest market and its share of total sales in this view.', 'أكبر سوق ونسبته من إجمالي المبيعات في هذا العرض.'],
    [/^top market growth/, 'The fastest-growing market in this view and its growth.', 'السوق الأسرع نمواً في هذا العرض ونسبة نموه.'],

    [/^stars/, 'Zeta products with high relative market share (≥ 0.5 of the biggest product in the same DM1 market) in a fast-growing market (3-year CAGR ≥ market average). Action: invest to grow.', 'منتجات زيتا ذات حصة سوقية نسبية مرتفعة (≥ 0.5 من أكبر منتج في نفس سوق DM1) في سوق سريع النمو (معدل نمو مركب 3 سنوات ≥ متوسط السوق). الإجراء: الاستثمار للنمو.'],
    [/^cash cows/, 'High relative market share (≥ 0.5) in a slow-growing market (3-year CAGR below market average). Action: defend share and generate cash.', 'حصة سوقية نسبية مرتفعة (≥ 0.5) في سوق بطيء النمو (معدل نمو مركب 3 سنوات أقل من متوسط السوق). الإجراء: الدفاع عن الحصة وتحقيق العائد.'],
    [/^question marks/, 'Low relative market share (below 0.5) in a fast-growing market. Action: invest selectively where Zeta can win, otherwise exit.', 'حصة سوقية نسبية منخفضة (أقل من 0.5) في سوق سريع النمو. الإجراء: استثمار انتقائي حيث يمكن لزيتا أن تنجح، وإلا الانسحاب.'],
    [/^dogs/, 'Low relative market share (below 0.5) in a slow-growing market. Action: minimum resources, review for exit.', 'حصة سوقية نسبية منخفضة (أقل من 0.5) في سوق بطيء النمو. الإجراء: أقل قدر من الموارد ومراجعة قرار الخروج.'],

    [/^high risk portfolios/, 'Companies whose top product is more than 50% of their sales.', 'الشركات التي يمثل منتجها الأول أكثر من 50% من مبيعاتها.'],
    [/^medium risk/, 'Companies whose top product is 30–50% of their sales.', 'الشركات التي يمثل منتجها الأول من 30% إلى 50% من مبيعاتها.'],
    [/^low risk/, 'Companies whose top product is 30% of their sales or less (diversified portfolio).', 'الشركات التي يمثل منتجها الأول 30% أو أقل من مبيعاتها (محفظة متنوعة).'],

    [/^market rank/, 'Zeta position among all companies by sales in the current view. The badge shows places gained (▲) or lost (▼) vs the prior period.', 'ترتيب زيتا بين كل الشركات حسب المبيعات في العرض الحالي. الشارة توضح المراكز المكتسبة (▲) أو المفقودة (▼) مقارنة بالفترة السابقة.'],
    [/^gap to leader/, 'Sales difference between Zeta and the #1 company. The sub-line shows what is needed to pass the next company above Zeta.', 'فرق المبيعات بين زيتا والشركة رقم 1. السطر الفرعي يوضح المطلوب لتجاوز الشركة التالية فوق زيتا.'],
    [/^mat growth/, 'Moving Annual Total growth: the last 12 months vs the 12 months before.', 'نمو المجموع السنوي المتحرك (MAT): آخر 12 شهراً مقارنة بالـ 12 شهراً السابقة لها.'],
    [/^ytd growth/, 'Year-to-date growth: January to the latest month vs the same months last year.', 'النمو منذ بداية العام (YTD): من يناير حتى آخر شهر مقارنة بنفس الشهور من العام الماضي.'],
    [/^market structure/, 'Concentration of this market based on HHI (0–10,000): Fragmented up to 1,500, Moderate 1,500–2,500, Concentrated above 2,500.', 'درجة تركيز هذا السوق حسب مؤشر HHI (من 0 إلى 10,000): مفتت حتى 1,500، متوسط من 1,500 إلى 2,500، مركّز أكثر من 2,500.'],
    [/^outgrowing market/, 'Number of competitors with EVI ≥ 110 (growing much faster than the market), excluding new launches.', 'عدد المنافسين الذين مؤشر تطورهم EVI ≥ 110 (ينمون أسرع كثيراً من السوق)، باستثناء الإطلاقات الجديدة.'],
    [/^outgrowing zeta/, 'Number of competitors growing faster than Zeta in this market.', 'عدد المنافسين الذين ينمون أسرع من زيتا في هذا السوق.'],
    [/^rising threats/, 'Competitors ranked below Zeta but with EVI ≥ 110: they are growing fast and may overtake Zeta.', 'منافسون ترتيبهم أقل من زيتا لكن مؤشر تطورهم EVI ≥ 110: ينمون بسرعة وقد يتجاوزون زيتا.'],
    [/^threats above/, 'Competitors ranked above Zeta that are also outgrowing the market (EVI ≥ 110): the gap to them is widening.', 'منافسون ترتيبهم أعلى من زيتا وينمون أسرع من السوق أيضاً (EVI ≥ 110): الفجوة معهم تتسع.'],
    [/^new player/, 'A company with sales now but none in the prior period. The sub-line shows its sales, rank and main products.', 'شركة لها مبيعات الآن ولم يكن لها مبيعات في الفترة السابقة. السطر الفرعي يوضح مبيعاتها وترتيبها وأهم منتجاتها.'],

    [/^market 12m consensus/, 'Forecast of total market sales for the next 12 months: the average (consensus) of three models (CAGR trend, moving average, linear trend).', 'توقع إجمالي مبيعات السوق للـ 12 شهراً القادمة: متوسط (إجماع) ثلاثة نماذج (اتجاه معدل النمو المركب، المتوسط المتحرك، الاتجاه الخطي).'],
    [/^zeta 12m consensus/, 'Forecast of Zeta sales for the next 12 months: the average of the same three models.', 'توقع مبيعات زيتا للـ 12 شهراً القادمة: متوسط نفس النماذج الثلاثة.'],
    [/^projected zeta share/, 'Zeta 12-month forecast ÷ market 12-month forecast: the share Zeta is expected to have in 12 months if current trends continue.', 'توقع زيتا لـ 12 شهراً ÷ توقع السوق لـ 12 شهراً: الحصة المتوقعة لزيتا بعد 12 شهراً إذا استمرت الاتجاهات الحالية.'],
    [/^market cagr/, 'Average monthly compound growth rate of the market over the trailing 12 months.', 'متوسط معدل النمو الشهري المركب للسوق خلال آخر 12 شهراً.'],
    [/^zeta rank/, 'Zeta rank among all companies by blended share across Zeta defined markets.', 'ترتيب زيتا بين كل الشركات حسب الحصة المجمعة في أسواق زيتا المحددة.'],
    [/^zeta blended share/, 'Zeta sales ÷ total sales of all Zeta defined markets combined (excluding the Other Markets BU).', 'مبيعات زيتا ÷ إجمالي مبيعات كل أسواق زيتا المحددة مجتمعة (باستثناء وحدة Other Markets).'],
    [/^market leader/, 'The company with the highest blended share across Zeta defined markets.', 'الشركة صاحبة أعلى حصة مجمعة في أسواق زيتا المحددة.'],

    [/^zeta .*iqvia vs in-house/, 'Zeta volume as reported by IQVIA vs Zeta in-house sell-in (Sales Performance) for the same actual months.', 'حجم مبيعات زيتا كما تسجله IQVIA مقابل مبيعات زيتا الداخلية (Sales Performance) لنفس الشهور الفعلية.'],
    [/^gap \(iqvia/, 'IQVIA minus in-house. Positive = IQVIA reports more than Zeta sold in; negative = IQVIA under-reports Zeta.', 'IQVIA ناقص المبيعات الداخلية. موجب = IQVIA تسجل أكثر مما باعته زيتا، سالب = IQVIA تسجل أقل من الواقع.'],
    [/^zeta actual share \(iqvia/, 'Zeta share using IQVIA figures for both Zeta and the market. It is kept constant when the market is calibrated.', 'حصة زيتا باستخدام أرقام IQVIA لزيتا وللسوق. تُثبت هذه الحصة عند معايرة حجم السوق.'],
    [/^market .*iqvia.*calibrated/, 'IQVIA market size vs the calibrated market (IQVIA market × in-house ÷ IQVIA factor): the market size implied by Zeta real sales.', 'حجم السوق حسب IQVIA مقابل السوق المُعاير (سوق IQVIA × معامل المبيعات الداخلية ÷ IQVIA): حجم السوق المستنتج من مبيعات زيتا الفعلية.'],
    [/^items by gap/, 'Zeta items split by gap: IQVIA over-reports / aligned (within ±15%) / IQVIA under-reports.', 'أصناف زيتا مقسمة حسب الفجوة: IQVIA أعلى من الواقع / متوافقة (في حدود ±15%) / IQVIA أقل من الواقع.'],

    [/^zeta total (lcv|su|packs|value)/, 'Total Zeta sales in the markets in view for the selected range; the sub-line shows growth vs the prior period.', 'إجمالي مبيعات زيتا في الأسواق المعروضة للفترة المختارة، والسطر الفرعي يوضح النمو مقارنة بالفترة السابقة.'],
    [/^avg portfolio rgi/, 'Average Relative Growth Index of Zeta across comparable DM1 markets. RGI = (1 + Zeta growth) ÷ (1 + market growth). 1.0 = growing with the market, above 1 = gaining share, below 1 = losing share.', 'متوسط مؤشر النمو النسبي لزيتا في أسواق DM1 القابلة للمقارنة. RGI = (1 + نمو زيتا) ÷ (1 + نمو السوق). 1.0 = نمو بنفس سرعة السوق، أكثر من 1 = كسب حصة، أقل من 1 = فقدان حصة.'],
    [/^markets outperforming/, 'Number of comparable DM1 markets where Zeta grows faster than the market (RGI ≥ 1). New or low-base markets are excluded.', 'عدد أسواق DM1 القابلة للمقارنة التي تنمو فيها زيتا أسرع من السوق (RGI ≥ 1)، مع استبعاد الأسواق الجديدة أو ذات القاعدة الصغيرة.'],
    [/^mkt concentration/, 'Average HHI of Zeta markets, weighted by market size (0–10,000). Below 1,000 = competitive, 1,000–1,800 = moderate, above 1,800 = highly concentrated.', 'متوسط مؤشر HHI لأسواق زيتا مرجحاً بحجم كل سوق (من 0 إلى 10,000). أقل من 1,000 = تنافسي، من 1,000 إلى 1,800 = متوسط، أكثر من 1,800 = تركيز مرتفع.'],
    [/^high conc\.? markets/, 'Number of markets with HHI above 1,800: one or two companies dominate, so share is harder to win.', 'عدد الأسواق التي مؤشر HHI فيها أكبر من 1,800: شركة أو شركتان تسيطران، لذا يصعب كسب حصة.'],
    [/^avg cr4/, 'Average combined share of the top 4 companies in each market, weighted by market size. Above 80% = closed market, below 50% = open market.', 'متوسط الحصة المجمعة لأكبر 4 شركات في كل سوق مرجحاً بحجم السوق. أكثر من 80% = سوق مغلق، أقل من 50% = سوق مفتوح.'],
    [/^market balance/, 'Gini coefficient of company sales (0 = all companies equal, 1 = one company has everything), weighted by market size. Below 0.3 = balanced, 0.3–0.6 = moderate, above 0.6 = imbalanced.', 'معامل جيني لمبيعات الشركات (0 = كل الشركات متساوية، 1 = شركة واحدة تملك كل شيء) مرجحاً بحجم السوق. أقل من 0.3 = متوازن، من 0.3 إلى 0.6 = متوسط، أكثر من 0.6 = غير متوازن.'],
    [/^zeta leads/, 'Number of markets where Zeta is the #1 company. The sub-line shows how many markets Zeta is in the top 3.', 'عدد الأسواق التي تحتل فيها زيتا المركز الأول، والسطر الفرعي يوضح عدد الأسواق التي تكون فيها ضمن أول 3 شركات.'],
    [/./, 'Blended market share of this BU / Line across its defined markets vs its weighted target share. Achievement = blended share ÷ target share × 100; the gap is in percentage points (pp).', 'الحصة السوقية المجمعة لهذه الوحدة / الخط في أسواقها المحددة مقارنة بالحصة المستهدفة المرجحة. نسبة التحقيق = الحصة المجمعة ÷ الحصة المستهدفة × 100، والفجوة بالنقاط المئوية (pp).', subHas(/of t(ar)?ge?t|est\. blended|est\.|no data/i)]
  ];

  /* ---------------- Charts ---------------- */
  var C = [
    [/bcg matrix/, 'Each bubble is a Zeta product: X = relative market share (product sales ÷ the biggest product in the same DM1; cut-off 0.5), Y = 3-year market CAGR (cut-off = weighted market average), bubble = Zeta value. Top-right = Stars, bottom-right = Cash Cows, top-left = Question Marks, bottom-left = Dogs.', 'كل فقاعة منتج من منتجات زيتا: المحور الأفقي = الحصة السوقية النسبية (مبيعات المنتج ÷ أكبر منتج في نفس سوق DM1، والحد 0.5)، الرأسي = معدل النمو المركب للسوق لـ 3 سنوات (الحد = متوسط السوق المرجح)، حجم الفقاعة = قيمة مبيعات زيتا. أعلى اليمين = النجوم، أسفل اليمين = البقرة الحلوب، أعلى اليسار = علامات الاستفهام، أسفل اليسار = الكلاب.'],
    [/^key players/, 'Leading companies in the selected ATC4 market with their sales, share and growth.', 'الشركات الرائدة في سوق ATC4 المختار مع مبيعاتها وحصتها ونموها.'],
    [/^market monthly trend/, 'Total market sales month by month. Use it to spot seasonality, trend breaks and acceleration.', 'إجمالي مبيعات السوق شهراً بشهر. يُستخدم لاكتشاف الموسمية وتغير الاتجاه وتسارع النمو.'],
    [/^(product )?monthly trend/, 'Monthly sales of the selected product over time.', 'المبيعات الشهرية للمنتج المختار عبر الزمن.'],
    [/atc4 (portfolio )?(share|mix)/, 'How sales split across ATC4 classes (pharmacological classes) for the selected range.', 'توزيع المبيعات على فئات ATC4 (الفئات الدوائية) للفترة المختارة.'],
    [/^top 10 corporations/, 'The 10 largest companies by sales in the selected range.', 'أكبر 10 شركات حسب المبيعات في الفترة المختارة.'],
    [/^corporation .*market share/, 'Market share of each company in the selected range.', 'الحصة السوقية لكل شركة في الفترة المختارة.'],
    [/^top 5 corporation monthly trend/, 'Monthly sales of the 5 largest companies, to see who is gaining momentum.', 'المبيعات الشهرية لأكبر 5 شركات لمعرفة من يكتسب زخماً.'],
    [/market share % — top \d+ \+ others/, 'Share split between the top players and all others combined.', 'توزيع الحصة بين أكبر اللاعبين وكل الباقين مجتمعين.'],
    [/^growth driver waterfall/, 'Bridge from prior to current sales: how much each product added (+) or removed (−). Shows which products drive or drag growth.', 'جسر من مبيعات الفترة السابقة إلى الحالية: مقدار ما أضافه (+) أو خصمه (−) كل منتج. يوضح المنتجات التي تقود النمو أو تعطله.'],
    [/^top 3 markets/, 'Monthly trend of the 3 largest markets in this view.', 'الاتجاه الشهري لأكبر 3 أسواق في هذا العرض.'],
    [/— monthly .*trend$/, 'Monthly sales trend of the selected company.', 'اتجاه المبيعات الشهرية للشركة المختارة.'],
    [/penetration/, 'Share of Zeta (or the selected company) in each market: where it is strong and where it is under-penetrated.', 'حصة زيتا (أو الشركة المختارة) في كل سوق: أين هي قوية وأين يكون تواجدها ضعيفاً.'],
    [/^atc4 market attractiveness/, 'Each bubble is an ATC4 market: X = growth, Y = market size, bubble = number of competitors, colour = fragmentation. Quadrants: Enter (high growth, fragmented), Compete (high growth, concentrated), Harvest (mature, fragmented), Avoid (low growth, concentrated).', 'كل فقاعة سوق ATC4: المحور الأفقي = النمو، الرأسي = حجم السوق، حجم الفقاعة = عدد المنافسين، اللون = درجة التفتت. الأرباع: ادخل (نمو مرتفع، مفتت)، نافس (نمو مرتفع، مركّز)، احصد (ناضج، مفتت)، تجنّب (نمو ضعيف، مركّز).'],
    [/market attractiveness/, 'Each bubble is a market: X = growth, Y = market size, bubble size = Zeta share; dashed lines = medians. Top-right = large and growing markets (priority).', 'كل فقاعة سوق: المحور الأفقي = النمو، الرأسي = حجم السوق، حجم الفقاعة = حصة زيتا، والخطوط المتقطعة = الوسيط. أعلى اليمين = أسواق كبيرة ومتنامية (أولوية).'],
    [/^value share distribution/, 'How total value is split across markets.', 'توزيع القيمة الإجمالية على الأسواق.'],
    [/^top 10 products/, 'The 10 best-selling products in the selected range.', 'أعلى 10 منتجات مبيعاً في الفترة المختارة.'],
    [/^product classification table/, 'BCG class of each Zeta product with its sales, relative market share (vs the biggest product in its DM1) and market growth.', 'تصنيف BCG لكل منتج من منتجات زيتا مع مبيعاته وحصته السوقية النسبية (مقارنة بأكبر منتج في سوق DM1) ونمو السوق.'],
    [/^portfolio concentration/, 'For each company, the share of sales from its top product. Higher = more dependence and risk.', 'لكل شركة، نسبة المبيعات من منتجها الأول. كلما ارتفعت زاد الاعتماد والمخاطرة.'],
    [/^portfolio size vs growth/, 'Companies plotted by number of products vs growth.', 'الشركات موزعة حسب عدد المنتجات مقابل النمو.'],
    [/24m revenue trend/, 'Monthly sales over the last 24 months (Zeta, or Zeta vs its top 4 competitors).', 'المبيعات الشهرية لآخر 24 شهراً (زيتا، أو زيتا مقابل أكبر 4 منافسين).'],
    [/^12m rank trajectory/, 'Zeta market rank month by month over the last 12 months.', 'ترتيب زيتا في السوق شهراً بشهر خلال آخر 12 شهراً.'],
    [/^competitive landscape/, 'Sales and growth of the top 8 companies in Zeta markets.', 'مبيعات ونمو أكبر 8 شركات في أسواق زيتا.'],
    [/^strategic position matrix/, 'Each bubble is a market: X = HHI (concentration), Y = Zeta share, bubble = market size. Low HHI + low Zeta share = opportunity to enter and grow.', 'كل فقاعة سوق: المحور الأفقي = مؤشر HHI (التركيز)، الرأسي = حصة زيتا، حجم الفقاعة = حجم السوق. HHI منخفض + حصة زيتا منخفضة = فرصة للدخول والنمو.', inSec('s-concentration')],
    [/^strategic position matrix/, 'Each bubble is a market: X = market growth, Y = Zeta share, bubble = market size. Green = Zeta outperforming the market (RGI ≥ 1), red = underperforming.', 'كل فقاعة سوق: المحور الأفقي = نمو السوق، الرأسي = حصة زيتا، حجم الفقاعة = حجم السوق. الأخضر = زيتا تتفوق على السوق (RGI ≥ 1)، الأحمر = أداء أقل من السوق.'],
    [/(market share win \/ loss|share gain \/ loss)/, 'Change in market share (pp) vs the prior period: who gained and who lost share.', 'التغير في الحصة السوقية (pp) مقارنة بالفترة السابقة: من كسب ومن فقد حصة.'],
    [/^market share — top 15/, 'Market share of the top 15 companies, with Zeta highlighted.', 'الحصة السوقية لأكبر 15 شركة مع إبراز زيتا.'],
    [/^growth rate comparison/, 'Growth of each competitor vs Zeta and the market in the selected range.', 'نمو كل منافس مقارنة بزيتا والسوق في الفترة المختارة.'],
    [/share (gainers|losers)/, 'Companies or products with the biggest increase (gainers) or decrease (losers) in market share vs the prior period, in pp.', 'الشركات أو المنتجات صاحبة أكبر زيادة (الرابحون) أو أكبر انخفاض (الخاسرون) في الحصة السوقية مقارنة بالفترة السابقة بالنقاط المئوية.'],
    [/^market concentration \(hhi\)/, 'HHI for each of the top 15 markets. Below 1,000 = competitive, 1,000–1,800 = moderate, above 1,800 = dominated by a few players.', 'مؤشر HHI لكل سوق من أكبر 15 سوقاً. أقل من 1,000 = تنافسي، من 1,000 إلى 1,800 = متوسط، أكثر من 1,800 = تسيطر عليه شركات قليلة.'],
    [/^forecast models/, '12-month forecast from 3 models (CAGR, 3-month moving average, linear trend) and their consensus (average). If models differ by more than 15%, use the forecast as directional only.', 'توقع 12 شهراً من 3 نماذج (معدل النمو المركب، المتوسط المتحرك 3 أشهر، الاتجاه الخطي) والإجماع (متوسطها). إذا اختلفت النماذج بأكثر من 15% يُستخدم التوقع كاتجاه عام فقط.'],
    [/^market vs zeta trend/, 'Actual and forecast monthly sales of the market and Zeta, to see whether Zeta keeps pace with the market.', 'المبيعات الشهرية الفعلية والمتوقعة للسوق ولزيتا، لمعرفة هل تواكب زيتا نمو السوق.'],
    [/^monthly zeta .*iqvia vs in-house/, 'Bars: Zeta monthly volume by IQVIA vs in-house. Line: calibration factor (in-house ÷ IQVIA).', 'الأعمدة: حجم زيتا الشهري حسب IQVIA مقابل المبيعات الداخلية. الخط: معامل المعايرة (الداخلي ÷ IQVIA).'],
    [/^gap by brand/, 'IQVIA minus in-house per brand: which brands IQVIA over- or under-reports.', 'IQVIA ناقص المبيعات الداخلية لكل علامة: أي العلامات تسجلها IQVIA بأعلى أو أقل من الواقع.'],
    [/^market .*iqvia vs calibrated/, 'Top 10 markets: IQVIA market size vs calibrated market size.', 'أكبر 10 أسواق: حجم السوق حسب IQVIA مقابل حجم السوق المُعاير.']
  ];

  /* ---------------- Tables ---------------- */
  var T = [
    [/^monthly zeta .*iqvia vs in-house/, 'Bars: Zeta monthly volume by IQVIA vs in-house. Line: calibration factor (in-house ÷ IQVIA).', 'الأعمدة: حجم زيتا الشهري حسب IQVIA مقابل المبيعات الداخلية. الخط: معامل المعايرة (الداخلي ÷ IQVIA).'],
    [/^gap by brand/, 'IQVIA minus in-house per brand: which brands IQVIA over- or under-reports.', 'IQVIA ناقص المبيعات الداخلية لكل علامة: أي العلامات تسجلها IQVIA بأعلى أو أقل من الواقع.'],
    [/^market .*iqvia vs calibrated/, 'Top 10 markets: IQVIA market size vs calibrated market size.', 'أكبر 10 أسواق: حجم السوق حسب IQVIA مقابل حجم السوق المُعاير.'],
    [/full kpi matrix/, 'Full comparison table: sales, share, growth, EVI and share change for each company or product.', 'جدول مقارنة كامل: المبيعات والحصة والنمو ومؤشر التطور EVI وتغير الحصة لكل شركة أو منتج.'],
    [/^top 10 products/, 'The 10 best-selling products with sales, share and growth.', 'أعلى 10 منتجات مبيعاً مع المبيعات والحصة والنمو.'],
    [/(product portfolio matrix|zeta product portfolio)/, 'Every product of the selected company with sales, share in its market, growth and EVI.', 'كل منتجات الشركة المختارة مع المبيعات والحصة في سوقها والنمو ومؤشر التطور EVI.'],
    [/penetration/, 'Share by DM1 market for Zeta (or the selected company), with market size and growth.', 'الحصة في كل سوق DM1 لزيتا (أو الشركة المختارة) مع حجم السوق ونموه.'],
    [/^growth drivers/, 'Markets ranked by growth vs the prior period, with the main reason for the change.', 'الأسواق مرتبة حسب النمو مقارنة بالفترة السابقة مع السبب الرئيسي للتغير.'],
    [/^new entrants/, 'Products with no sales in the prior period that entered the market in this window.', 'المنتجات التي لم يكن لها مبيعات في الفترة السابقة ودخلت السوق في هذه الفترة.'],
    [/^full (market )?rankings/, 'All markets ranked by size with growth, Zeta share and competition level.', 'كل الأسواق مرتبة حسب الحجم مع النمو وحصة زيتا ومستوى المنافسة.'],
    [/^fastest growing/, 'Markets with the highest growth.', 'الأسواق صاحبة أعلى نمو.'],
    [/^declining markets/, 'Markets with negative growth.', 'الأسواق التي تراجعت مبيعاتها.'],
    [/^top 25 products/, 'Full table for the top 25 products: sales, share, growth and EVI.', 'جدول كامل لأعلى 25 منتجاً: المبيعات والحصة والنمو ومؤشر التطور EVI.'],
    [/^zeta dm1 full performance/, 'Zeta in every DM1 market: sales, share, share change, growth and EVI vs the market.', 'أداء زيتا في كل سوق DM1: المبيعات والحصة وتغير الحصة والنمو ومؤشر التطور مقارنة بالسوق.'],
    [/^full competitive league table/, 'All companies in the market ranked by sales, with share, growth, EVI and rank change.', 'كل الشركات في السوق مرتبة حسب المبيعات مع الحصة والنمو ومؤشر التطور وتغير الترتيب.'],
    [/^share (gainers|losers)/, 'Companies with the largest share gain or loss vs the prior period, in pp.', 'الشركات صاحبة أكبر كسب أو فقدان للحصة مقارنة بالفترة السابقة بالنقاط المئوية.'],
    [/rank (climbers|fallers)/, 'Companies or products that moved up (climbers) or down (fallers) the most in rank vs the prior period.', 'الشركات أو المنتجات التي تقدمت (الصاعدون) أو تراجعت (الهابطون) أكثر في الترتيب مقارنة بالفترة السابقة.'],
    [/^full (corporation|product) share analysis/, 'Full list with current share, prior share, share change and rank change.', 'القائمة الكاملة مع الحصة الحالية والسابقة وتغير الحصة وتغير الترتيب.'],
    [/^full market concentration detail/, 'HHI, top company share and Zeta share for every market.', 'مؤشر HHI وحصة الشركة الأولى وحصة زيتا لكل سوق.'],
    [/^portfolio analysis/, 'Top 15 companies: portfolio size, concentration and risk.', 'أكبر 15 شركة: حجم المحفظة ودرجة التركيز والمخاطرة.']
  ];

  var GROUPS = [
    { sel: '.kpi-label', card: '.kpi-card', list: K },
    { sel: '.chart-box-title', card: '.chart-box', list: C },
    { sel: '.tbl-head-title', card: '.tbl-head', list: T }
  ];
  var EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿️‍]/gu;
  window.__IQCI_MISSING = window.__IQCI_MISSING || {};
  window.__IQCI_DEFS = { K: K, C: C, T: T };

  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) t += n.nodeValue; }
    t = t.trim();
    if (!t) t = el.textContent || '';
    return t.replace(EMOJI, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isIqviaActive() {
    var a = document.querySelector('#sidebar-nav .menu-item.active');
    return !!(a && a.getAttribute('data-tab') === 'iqvia');
  }
  function find(list, title, ctx) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e[0].test(title) && (!e[3] || e[3](ctx))) return e;
    }
    return null;
  }
  window.__IQCI_FIND = function (kind, title, sub) {
    return find({ K: K, C: C, T: T }[kind], String(title).replace(EMOJI, '').replace(/\s+/g, ' ').trim().toLowerCase(),
      { el: { closest: function () { return null; } }, sub: sub || '' });
  };

  /* ---------- popover ---------- */
  var pop = null, pinned = false, curIcon = null;
  function ensurePop(host) {
    if (pop && pop.isConnected && pop.parentNode === host) return pop;
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = document.createElement('div');
    pop.className = 'iqci-pop'; pop.setAttribute('role', 'tooltip');
    host.appendChild(pop);
    return pop;
  }
  function show(icon, pin) {
    var host = icon.closest('.iqvia-dashboard-wrap') || document.body;
    var p = ensurePop(host);
    p.innerHTML = '<div class="iqci-t">' + esc(icon.getAttribute('data-iqci-title')) + '</div>'
      + '<div class="iqci-en" dir="ltr"><span class="iqci-lang">EN</span>' + esc(icon.getAttribute('data-iqci-en')) + '</div>'
      + '<div class="iqci-ar" dir="rtl" lang="ar"><span class="iqci-lang">ع</span>' + esc(icon.getAttribute('data-iqci-ar')) + '</div>';
    p.style.display = 'block'; p.style.left = '0px'; p.style.top = '0px';
    var r = icon.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    var top = r.bottom + 8; if (top + h > vh - 8) top = Math.max(8, r.top - h - 8);
    p.style.left = left + 'px'; p.style.top = top + 'px';
    pinned = !!pin; curIcon = icon;
  }
  function hide() { if (pop) pop.style.display = 'none'; pinned = false; curIcon = null; }

  function makeIcon(e, label) {
    var s = document.createElement('span');
    s.className = 'iqci-i'; s.textContent = 'i';
    s.setAttribute('role', 'button'); s.setAttribute('tabindex', '0');
    s.setAttribute('aria-label', 'What this card means / معنى هذا الكارت');
    s.setAttribute('data-iqci-title', label);
    s.setAttribute('data-iqci-en', e[1]); s.setAttribute('data-iqci-ar', e[2]);
    s.addEventListener('mouseenter', function () { if (!pinned) show(s, false); });
    s.addEventListener('mouseleave', function () { if (!pinned) hide(); });
    s.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    s.addEventListener('click', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (pinned && curIcon === s) hide(); else show(s, true);
    });
    s.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(s, true); } });
    return s;
  }

  function scan() {
    if (!isIqviaActive()) return;
    var root = document.querySelector('#app-root > .iqvia-dashboard-wrap');
    if (!root) return;
    GROUPS.forEach(function (g) {
      root.querySelectorAll(g.sel + ':not([data-iqci])').forEach(function (el) {
        var title = ownText(el);
        el.setAttribute('data-iqci', '0');
        if (!title) return;
        var card = el.closest(g.card) || el.parentNode;
        var subEl = card && card.querySelector('.kpi-sub');
        var ctx = { el: el, sub: subEl ? subEl.textContent : '' };
        var e = find(g.list, title, ctx);
        if (!e) { window.__IQCI_MISSING[g.sel + ' | ' + title] = 1; return; }
        el.setAttribute('data-iqci', '1');
        var label = (el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : el.textContent).replace(/\s+/g, ' ').trim();
        el.appendChild(makeIcon(e, label));
      });
    });
  }

  var timer = null;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; try { scan(); } catch (err) { if (window.console) console.warn('[iqvia-card-info]', err); } }, 150); }
  function start() {
    var appRoot = document.getElementById('app-root');
    if (!appRoot) { setTimeout(start, 500); return; }
    new MutationObserver(function () { schedule(); }).observe(appRoot, { childList: true, subtree: true });
    var nav = document.getElementById('sidebar-nav');
    if (nav) new MutationObserver(function () { schedule(); }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
    schedule();
  }
  document.addEventListener('click', function (ev) { if (pinned && pop && !pop.contains(ev.target)) hide(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') hide(); });
  window.addEventListener('scroll', function () { if (!pinned) hide(); }, true);
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
