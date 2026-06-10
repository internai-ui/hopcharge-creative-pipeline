import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  await prisma.agentAction.deleteMany()
  await prisma.pipelineIssue.deleteMany()
  await prisma.performanceSnapshot.deleteMany()
  await prisma.post.deleteMany()
  await prisma.creative.deleteMany()
  await prisma.idea.deleteMany()
  await prisma.trendContext.deleteMany()

  // --- TrendContext ---
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const oldTrendContext = await prisma.trendContext.create({
    data: {
      createdAt: sevenDaysAgo,
      summary: 'Doorstep EV charging and apartment charging solutions are rising sharply in Delhi-NCR search interest. Tata EV ownership content is highly engaged. UGC-style Reels outperform cinematic ads 2x on Meta India. Summer road trip content has declined as monsoon season ends.',
      risingTopics: [
        { topic: 'apartment EV charging India', rationale: 'Rapid Tata EV adoption among apartment dwellers searching for charging solutions', googleTrendsScore: 74 },
        { topic: 'Tata Nexon EV', rationale: 'Model-specific search volume growing with new deliveries', googleTrendsScore: 71 },
        { topic: 'doorstep EV charging', rationale: 'Awareness of on-demand charging services growing in NCR', googleTrendsScore: 68 },
      ],
      decliningTopics: [
        { topic: 'EV road trip India', rationale: 'Post-monsoon road trip season winding down', googleTrendsScore: 48 },
        { topic: 'monsoon EV driving', rationale: 'Seasonal content peaked mid-monsoon', googleTrendsScore: 44 },
      ],
      platformFormatTrends: [
        { format: 'ugc_reels', trend: 'rising', notes: '2x CTR vs cinematic on Meta India; 45% higher completion rate' },
        { format: 'talking_head', trend: 'stable', notes: 'Works well for myth-busting and education content' },
        { format: 'cinematic', trend: 'declining', notes: 'Feels too polished for current Indian Meta audience; high CPM' },
        { format: 'text_on_screen', trend: 'rising', notes: '80% of Reels watched muted — captions essential' },
      ],
      competitorAdInsights: 'Competitors (Tata ChargeZone, Statiq, BOLT) running primarily charger-location ads and cost-comparison creatives. None targeting apartment-dweller pain point specifically. Convenience angle ("charge at home without installation") is underserved.',
      topicScores: {
        'apartment_ev_charging': 0.74, 'tata_nexon_ev': 0.71, 'doorstep_charging': 0.68,
        'fast_charging_india': 0.69, 'ev_range_anxiety': 0.52, 'ev_road_trip': 0.48,
        'monsoon_ev': 0.44, 'delhi_ncr_ev': 0.72, 'ev_subscription': 0.61,
        'petrol_vs_ev': 0.67, 'ugc_reels': 0.79, 'talking_head': 0.72,
        'tata_ev': 0.75, 'on_demand_ev': 0.65,
      },
      rawSources: { source: 'seed' },
    },
  })

  const latestTrendContext = await prisma.trendContext.create({
    data: {
      summary: 'Apartment EV charging anxiety is the dominant pain point in Delhi-NCR search data. Tata EV model searches (Nexon, Tiago, Punch) are at peak. Doorstep charging awareness is accelerating post Tata.ev partnership announcement. UGC Reels and text-on-screen formats are outperforming all other formats on Meta India.',
      risingTopics: [
        { topic: 'apartment EV charging India', rationale: 'Sustained growth as more Tata EVs are delivered to apartment residents', googleTrendsScore: 82 },
        { topic: 'Tata EV', rationale: 'All Tata EV model searches at combined peak; new Curvv EV deliveries starting', googleTrendsScore: 79 },
        { topic: 'doorstep EV charging', rationale: 'Tata.ev partnership press coverage driving awareness spike', googleTrendsScore: 76 },
        { topic: 'Delhi NCR EV', rationale: 'EV policy incentives driving purchase surge in NCR', googleTrendsScore: 74 },
      ],
      decliningTopics: [
        { topic: 'EV road trip India', rationale: 'Post-monsoon road trip content has peaked and is fading', googleTrendsScore: 39 },
        { topic: 'monsoon EV driving', rationale: 'Monsoon season over; seasonal content no longer relevant', googleTrendsScore: 31 },
        { topic: 'ev range anxiety', rationale: 'Consumer narrative shifting from fear to convenience', googleTrendsScore: 49 },
      ],
      platformFormatTrends: [
        { format: 'ugc_reels', trend: 'rising', notes: '2.4x CTR vs cinematic; 50% completion rate on 15s format' },
        { format: 'text_on_screen', trend: 'rising', notes: 'Essential for muted viewing — 80% of Reels watched without sound' },
        { format: 'talking_head', trend: 'stable', notes: 'High trust for myth-busting; works with Indian creators' },
        { format: 'cinematic', trend: 'declining', notes: 'CPM too high; audience resonance dropping on Meta India' },
      ],
      competitorAdInsights: 'ChargeZone and Statiq doubled UGC ad volume in past 30 days. Cost-savings messaging dominates (petrol vs electric). No competitor is owning the apartment/no-installation angle. Tata.ev ads focus on vehicle features, not charging — leaves charging story open for Hopcharge.',
      topicScores: {
        'apartment_ev_charging': 0.82, 'tata_ev': 0.79, 'doorstep_charging': 0.76,
        'delhi_ncr_ev': 0.74, 'fast_charging_india': 0.71, 'ev_range_anxiety': 0.49,
        'ev_road_trip': 0.39, 'monsoon_ev': 0.31, 'ev_subscription': 0.65,
        'petrol_vs_ev': 0.69, 'ugc_reels': 0.81, 'talking_head': 0.73,
        'tata_nexon_ev': 0.77, 'on_demand_ev': 0.70, 'rescuecharge': 0.62,
      },
      rawSources: { source: 'seed' },
    },
  })

  console.log('Created TrendContext records')

  // --- Ideas ---
  const ideas = await Promise.all([
    // 0 — published, strong performer
    prisma.idea.create({ data: {
      title: 'The Apartment Wall',
      hook: 'My building said no to a home charger. Hopcharge said yes.',
      imageVisual: 'Split composition: left half shows a printed "No Charger Installation" notice pinned to an apartment notice board; right half shows a white Hopcharge van charging a Tata Nexon EV in the same building\'s parking bay — matching warm afternoon light across both halves',
      videoVisual: 'UGC-style: young woman films the building notice board, sighs; cuts to her opening Hopcharge app; cuts to van pulling into her gated colony — security barrier lifting; close on charging cable clicking in; final shot — she walks away to her lobby, unbothered',
      cta: 'Works for any apartment — book now',
      angle: 'pain_point', rank: 1, status: 'published', sourceType: 'ai_generated',
      trendTags: ['apartment_ev_charging', 'no_home_charger', 'doorstep_charging'],
      trendScore: 0.80, trendScoredAt: new Date(), performanceScore: 3.4,
    }}),

    // 1 — published, top performer
    prisma.idea.create({ data: {
      title: 'Van at Your Doorstep',
      hook: 'I never installed a charger. The charger came to me.',
      imageVisual: 'Overhead aerial still: a white Hopcharge branded van parked in a clean premium apartment colony lot, charging cable running to a silver Tata Nexon EV — soft golden morning light, no people, serene geometry',
      videoVisual: 'Slow aerial push-in: Hopcharge van rolls through a gated colony gate at dawn; owner steps out of lobby, phone in hand; cable connects with a close-up click; time-lapse of charge bar filling from 20% to 100%; owner drives out confidently into Gurugram traffic',
      cta: 'Schedule your first charge',
      angle: 'convenience', rank: 2, status: 'published', sourceType: 'ai_generated',
      trendTags: ['doorstep_charging', 'tata_ev', 'on_demand_ev'],
      trendScore: 0.75, trendScoredAt: new Date(), performanceScore: 4.1,
    }}),

    // 2 — in_production
    prisma.idea.create({ data: {
      title: '₹3.5 Per Km — The Real Math',
      hook: 'Petrol at ₹8/km. Hopcharge at ₹3.5/km. You do the math.',
      imageVisual: 'High-contrast typographic split: left panel shows a petrol station receipt (₹8 per km, harsh red-orange palette); right panel shows Hopcharge app charge summary screen (₹3.5 per km, clean electric blue) — bold, instantly legible at thumb-scroll speed',
      videoVisual: 'Fast-cut: petrol pump meter spinning rapidly, rupee bills animated flying out; hard cut to Hopcharge app summary showing ₹3.5/km — rupees trickling slowly; cut to real Indian professional driving Tata Tiago EV, smiling; end card with monthly savings figure and Hopcharge branding',
      cta: 'Calculate your monthly savings',
      angle: 'curiosity_gap', rank: 3, status: 'in_production', sourceType: 'ai_generated',
      trendTags: ['petrol_vs_ev', 'ev_cost_savings', 'tata_ev'],
      trendScore: 0.74, trendScoredAt: new Date(),
    }}),

    // 3 — selected, stale trend warning
    prisma.idea.create({ data: {
      title: 'EV Road Trip Delhi to Manali',
      hook: 'We drove from Delhi to Manali on electric — here\'s how we charged.',
      imageVisual: 'Cinematic landscape: Tata Nexon EV parked on a mountain highway with Himachal Pradesh peaks behind, Hopcharge branded cable connected to a portable charging unit — golden hour light, aspirational travel energy',
      videoVisual: 'Travel montage: couple loads Tata Nexon EV in Delhi colony parking; highway driving time-lapse; Hopcharge van meets them at a pre-booked stop in Chandigarh; mountain scenery; final arrival in Manali — 100% battery shown on phone',
      cta: 'Plan your electric road trip',
      angle: 'social_proof', rank: 4, status: 'selected', sourceType: 'ai_generated',
      trendTags: ['ev_road_trip', 'delhi_ncr_ev'],
      trendScore: 0.39, trendScoredAt: new Date(),
      trendWarning: 'Post-monsoon road trip content has peaked and is declining (score: 39). Consider refreshing this angle for winter travel season.',
    }}),

    // 4 — pending
    prisma.idea.create({ data: {
      title: 'Never Call a Tow Truck Again',
      hook: 'Dead EV battery at 11 PM in Gurugram. RescueCharge arrived in 40 minutes.',
      imageVisual: 'Night scene: stranded Tata Punch EV on a quiet Gurugram road, hazard lights blinking orange — Hopcharge van headlights approaching in the dark background, creating dramatic blue-orange contrast',
      videoVisual: 'Handheld UGC: woman films her dead EV on a dark street; opens Hopcharge app, taps RescueCharge, confirms booking; 40-minute time card; van arrives — wide shot to close on cable connection; she drives away safely; end card "RescueCharge — available 24/7"',
      cta: 'Add RescueCharge to your plan',
      angle: 'problem_solution', rank: 5, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['rescuecharge', 'ev_range_anxiety', 'on_demand_ev'],
      trendScore: 0.66, trendScoredAt: new Date(),
    }}),

    // 5 — pending
    prisma.idea.create({ data: {
      title: 'Tata EV × Hopcharge — Official',
      hook: 'Got a Tata EV? You\'re already covered. Hopcharge is the official charging partner.',
      imageVisual: 'Brand partnership shot: a Tata Curvv EV and the white Hopcharge van parked side by side in a spotless Tata dealership forecourt — golden hour light, premium symmetrical composition, no clutter',
      videoVisual: 'Cinematic brand film: Tata Curvv EV drives into frame and parks; Hopcharge van pulls alongside; charging cable connects; time-lapse of charge; both vehicles drive away in opposite directions; end title — "Tata.ev × Hopcharge: Official Charging Partner" with app download CTA',
      cta: 'Included with select Tata EV plans',
      angle: 'social_proof', rank: 6, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['tata_ev', 'tata_nexon_ev', 'doorstep_charging'],
      trendScore: 0.78, trendScoredAt: new Date(),
    }}),

    // 6 — pending
    prisma.idea.create({ data: {
      title: 'The Renter\'s EV Myth',
      hook: 'Everyone said I can\'t own an EV in a rented apartment. They were wrong.',
      imageVisual: 'Talking-head close-up: young professional in modern Noida apartment, direct to camera, slightly smiling — Hopcharge app visible on phone in hand, apartment building visible through window behind them',
      videoVisual: 'Vertical talking-head Reel: creator addresses myth directly — "You can\'t charge an EV if you rent"; debunks it with Hopcharge booking; cut to van arriving at rented apartment complex; back to creator — "I own a Tata Tiago EV and I rent. Hopcharge charges it for me."',
      cta: 'EV ownership just got easier',
      angle: 'education', rank: 7, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['apartment_ev_charging', 'tata_ev', 'on_demand_ev'],
      trendScore: 0.79, trendScoredAt: new Date(),
    }}),

    // 7 — pending
    prisma.idea.create({ data: {
      title: 'Book It Tonight, Wake Up Charged',
      hook: 'I book tomorrow\'s charge while watching Netflix. Wake up to 100%.',
      imageVisual: 'Phone screen in dim bedroom: Hopcharge app showing tomorrow\'s confirmed booking — "7:00 AM, 80% → 100%, ₹420" — Tata Nexon EV key fob on the bedside table, soft warm lamp light',
      videoVisual: 'Evening routine montage: person on sofa opens Hopcharge, books a slot for 7 AM with 3 taps; cut to morning — van already in parking, cable connected; owner walks out with coffee, disconnects, drives to Cyber City in Gurugram; commute looks effortless',
      cta: 'Book up to 48 hours ahead',
      angle: 'lifestyle', rank: 8, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['ev_subscription', 'doorstep_charging', 'apartment_ev_charging'],
      trendScore: 0.74, trendScoredAt: new Date(),
    }}),

    // 8 — pending
    prisma.idea.create({ data: {
      title: 'The Gurugram EV Morning',
      hook: 'A day in the life of an EV owner in Gurugram — no charging station, no stress.',
      imageVisual: 'Lifestyle flat-lay on a minimal desk: Gurugram glass towers visible through a window, Tata Nexon EV key, phone with Hopcharge app confirmation open, black coffee — aspirational urban professional morning aesthetic, clean daylight',
      videoVisual: 'Day-in-the-life vlog format: 6:45 AM alarm — van quietly charging in parking while owner has breakfast; 8 AM commute through Cyber Hub; 5 PM check — next morning\'s booking already confirmed in app; end card "Zero charging stress. Just drive." over Gurugram skyline',
      cta: 'Start your Hopcharge subscription',
      angle: 'lifestyle', rank: 9, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['delhi_ncr_ev', 'apartment_ev_charging', 'tata_ev'],
      trendScore: 0.78, trendScoredAt: new Date(),
    }}),

    // 9 — pending/archived stale
    prisma.idea.create({ data: {
      title: 'Monsoon EV Driving Tips',
      hook: 'Charging your EV in the monsoon — what you actually need to know.',
      imageVisual: 'Rainy street scene: Tata Punch EV parked outside an apartment building, rain streaking the windshield — Hopcharge waterproof cable visible, puddles reflecting city lights, moody blue-grey palette',
      videoVisual: 'Educational talking-head: EV owner in a rain-streaked apartment window addresses monsoon charging myths; cuts to Hopcharge van operating normally in light rain; back to creator — "The van is waterproof. The charge works. Stop worrying."',
      cta: 'Rain or shine, we charge your EV',
      angle: 'education', rank: 10, status: 'archived', sourceType: 'human_added',
      trendTags: ['monsoon_ev', 'apartment_ev_charging'],
      trendScore: 0.31, trendScoredAt: new Date(),
      trendWarning: 'Monsoon season has ended — seasonal content is no longer relevant (score: 31). Archive and revisit next June.',
    }}),

    // 10 — pending
    prisma.idea.create({ data: {
      title: 'One Subscription, Zero Hassle',
      hook: 'I subscribed to Hopcharge six months ago. I haven\'t thought about charging since.',
      imageVisual: 'Clean product shot: three Hopcharge plan cards (Experience / Success 3.3 / Success 7.2) laid out on a white surface with subtle electric-blue accent lighting — minimal, professional, easily scannable',
      videoVisual: 'Subscription explainer: plan cards animate in one by one with feature callouts (sessions, RescueCharge, months); quick cuts to real footage of van arriving, cable connecting, app confirming; end with CTA overlay and app store badges',
      cta: 'See plans starting at ₹50,000/year',
      angle: 'convenience', rank: 11, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['ev_subscription', 'doorstep_charging', 'rescuecharge'],
      trendScore: 0.68, trendScoredAt: new Date(),
    }}),

    // 11 — pending
    prisma.idea.create({ data: {
      title: 'New Tata EV — Now What?',
      hook: 'Just picked up your Tata EV from the dealership. Here\'s your first charging decision.',
      imageVisual: 'Discovery moment: smiling Indian couple standing beside a brand-new Tata Punch EV at dealership, both looking at phone — Hopcharge app open showing first booking — confetti/celebration energy, warm dealership lighting',
      videoVisual: 'New-owner journey: unboxing energy — couple at Tata dealership taking delivery; driving home excited; realisation shot — apartment, no charger point; one partner searches "EV charging apartment Delhi"; finds Hopcharge; first booking placed; van arrives next morning — they high-five',
      cta: 'The charging solution for new Tata EV owners',
      angle: 'discovery', rank: 12, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['tata_ev', 'apartment_ev_charging', 'on_demand_ev'],
      trendScore: 0.80, trendScoredAt: new Date(),
    }}),

    // 12 — pending
    prisma.idea.create({ data: {
      title: 'Charge at the Office Too',
      hook: 'Hopcharge doesn\'t just come to your home. It comes to your office parking too.',
      imageVisual: 'Modern corporate parking: white Hopcharge van next to a Tata Curvv EV in a clean multi-level Gurugram office parking structure — "Office Charging" text visible on van, professional daytime lighting',
      videoVisual: 'Office day montage: professional arrives at work, parks Tata Nexon EV; opens Hopcharge app, books "Office Parking, 10 AM–2 PM"; van arrives in the parking structure; cable runs to car; professional works at desk uninterrupted; walks back to fully charged car at 2 PM',
      cta: 'Home, office, anywhere in NCR',
      angle: 'convenience', rank: 13, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['doorstep_charging', 'delhi_ncr_ev', 'on_demand_ev'],
      trendScore: 0.73, trendScoredAt: new Date(),
    }}),

    // 13 — pending
    prisma.idea.create({ data: {
      title: 'Drive India\'s Electric Future',
      hook: 'Every Hopcharge session is one less petrol car on Delhi\'s roads.',
      imageVisual: 'Aspirational wide shot: clean elevated Delhi highway at golden hour, Tata EV in foreground moving smoothly, smoggy skyline transitioning to clear sky in a split — "Your charge. Your impact." typography overlay',
      videoVisual: 'Values montage: data animation of CO₂ saved per Hopcharge session; Delhi air quality improving; families in parks; Tata EV driving on empty morning roads; Hopcharge van in colony parking; end title "Join 10,000+ EV owners charging cleaner in NCR"',
      cta: 'Charge greener. Drive further.',
      angle: 'values', rank: 14, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['delhi_ncr_ev', 'tata_ev', 'on_demand_ev'],
      trendScore: 0.74, trendScoredAt: new Date(),
    }}),

    // 14 — pending
    prisma.idea.create({ data: {
      title: 'Skip the Charging Station Queue',
      hook: 'Public chargers in Gurugram have a 45-minute wait. Hopcharge has zero.',
      imageVisual: 'Contrast shot: left side shows a busy public EV charging station with three cars queued, frustrated drivers visible; right side shows a Hopcharge van pulling directly into a private apartment parking bay — same frame, stark contrast',
      videoVisual: 'Documentary-style: handheld footage of packed public charger queue in Gurugram; timer ticking — 45 minutes; hard cut to Hopcharge app booking confirmed; van arrives at user\'s apartment in 30 minutes; cable in, charging starts immediately; "No queue. No wait. Just charge."',
      cta: 'Book your private charger now',
      angle: 'problem_solution', rank: 15, status: 'pending', sourceType: 'ai_generated',
      trendTags: ['apartment_ev_charging', 'doorstep_charging', 'fast_charging_india'],
      trendScore: 0.77, trendScoredAt: new Date(),
    }}),
  ])

  console.log('Created 15 ideas')

  // --- Creatives ---
  const creative1 = await prisma.creative.create({
    data: { ideaId: ideas[0].id, status: 'published', generatorName: 'kling', originalFilePath: 'creatives/seed-1/original.mp4', isHumanEdited: false, durationSeconds: 15, metadata: { style: 'ugc' } },
  })
  const creative2 = await prisma.creative.create({
    data: { ideaId: ideas[1].id, status: 'published', generatorName: 'veo', originalFilePath: 'creatives/seed-2/original.mp4', editedFilePath: 'creatives/seed-2/edited.mp4', isHumanEdited: true, durationSeconds: 20, metadata: { style: 'cinematic' } },
  })
  const creative3 = await prisma.creative.create({
    data: { ideaId: ideas[2].id, status: 'approved', generatorName: 'runway', originalFilePath: 'creatives/seed-3/original.mp4', isHumanEdited: false, durationSeconds: 15 },
  })
  const creative4 = await prisma.creative.create({
    data: { ideaId: ideas[3].id, status: 'ready_for_review', generatorName: 'stub', isHumanEdited: false },
  })
  const creative5 = await prisma.creative.create({
    data: { ideaId: ideas[4].id, status: 'generating', generatorName: 'runway', generatorJobId: 'stub-job-seed-5', isHumanEdited: false },
  })
  await prisma.creative.create({
    data: { ideaId: ideas[2].id, status: 'rejected', generatorName: 'kling', isHumanEdited: false, metadata: { rejectionReason: 'Visual did not match brief — showed Western suburb, not Indian apartment colony' } },
  })

  console.log('Created 6 creatives')

  // --- Posts ---
  const post1 = await prisma.post.create({
    data: { creativeId: creative1.id, platform: 'meta', status: 'posted', postedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), externalPostId: 'act_123456789_post_001', platformMetadata: { campaignId: 'camp_001', adSetId: 'adset_001' } },
  })
  const post2 = await prisma.post.create({
    data: { creativeId: creative2.id, platform: 'meta', status: 'posted', postedAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000), externalPostId: 'act_123456789_post_002', platformMetadata: { campaignId: 'camp_001', adSetId: 'adset_001' } },
  })
  await prisma.post.create({
    data: { creativeId: creative3.id, platform: 'meta', status: 'queued', platformMetadata: { campaignId: 'camp_002', adSetId: 'adset_002' } },
  })

  console.log('Created 3 posts')

  // --- 30 days of performance snapshots ---
  for (let d = 29; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000)
    date.setHours(0, 0, 0, 0)
    const dayProgress = (29 - d) / 29

    // post1 (Apartment Wall): good performer, slight fatigue at end
    const p1Roas = 3.2 + Math.sin(dayProgress * Math.PI) * 0.8 + (Math.random() - 0.5) * 0.3
    const p1Freq = 1.2 + dayProgress * 2.5
    const p1Impressions = Math.floor(8000 + Math.random() * 3000)
    const p1Spend = 120 + Math.random() * 40
    await prisma.performanceSnapshot.create({
      data: {
        postId: post1.id, snapshotDate: date,
        impressions: p1Impressions, reach: Math.floor(p1Impressions * 0.82),
        clicks: Math.floor(p1Impressions * 0.025),
        spend: new Decimal(p1Spend.toFixed(2)),
        roas: new Decimal(Math.max(0.5, p1Roas).toFixed(4)),
        cpm: new Decimal((p1Spend / p1Impressions * 1000).toFixed(4)),
        ctr: new Decimal((Math.floor(p1Impressions * 0.025) / p1Impressions).toFixed(6)),
        frequency: new Decimal(p1Freq.toFixed(4)),
        rawData: { source: 'seed', day: d },
      },
    })

    // post2 (Van at Your Doorstep): top performer, consistent ROAS ~4.5
    const p2Roas = 4.2 + Math.random() * 1.0 - (dayProgress > 0.8 ? dayProgress * 0.5 : 0)
    const p2Impressions = Math.floor(12000 + Math.random() * 5000)
    const p2Spend = 200 + Math.random() * 80
    await prisma.performanceSnapshot.create({
      data: {
        postId: post2.id, snapshotDate: date,
        impressions: p2Impressions, reach: Math.floor(p2Impressions * 0.88),
        clicks: Math.floor(p2Impressions * 0.035),
        spend: new Decimal(p2Spend.toFixed(2)),
        roas: new Decimal(Math.max(1.0, p2Roas).toFixed(4)),
        cpm: new Decimal((p2Spend / p2Impressions * 1000).toFixed(4)),
        ctr: new Decimal((Math.floor(p2Impressions * 0.035) / p2Impressions).toFixed(6)),
        frequency: new Decimal((1.1 + dayProgress * 1.2).toFixed(4)),
        rawData: { source: 'seed', day: d },
      },
    })
  }

  console.log('Created 60 performance snapshots (30 days × 2 posts)')

  // --- Pipeline Issues ---
  await prisma.pipelineIssue.createMany({
    data: [
      { severity: 'critical', stage: 'analytics', description: `Post ${post1.id} has had ROAS below 1.0 for 3 consecutive days — creative fatiguing`, relatedEntityId: post1.id, isResolved: false },
      { severity: 'warning', stage: 'analytics', description: `Creative fatigue detected on post ${post1.id}: frequency 3.7, ROAS dropped 28% from peak`, relatedEntityId: post1.id, isResolved: false },
      { severity: 'warning', stage: 'production', description: `Creative ${creative5.id} has been generating for over 30 minutes`, relatedEntityId: creative5.id, isResolved: false },
      { severity: 'info', stage: 'idea_generation', description: 'Feedback loop generated 5 new ideas based on performance data — apartment_ev_charging and doorstep_charging angles prioritised', isResolved: true, resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      { severity: 'info', stage: 'trend_analysis', description: 'Trend context refreshed. 2 ideas demoted due to stale trends (ev_road_trip, monsoon_ev)', isResolved: true, resolvedAt: new Date() },
    ],
  })

  console.log('Created 5 pipeline issues')

  // --- Agent Actions ---
  await prisma.agentAction.createMany({
    data: [
      { createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), actionType: 'trend_context_updated', decisionRationale: 'Trend context created. Key findings: apartment_ev_charging rising (74→82), tata_ev at peak (79), doorstep_charging accelerating. Road trip and monsoon content declining sharply. Re-scored 8 ideas.', relatedEntityId: oldTrendContext.id },
      { createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), actionType: 'idea_generated', decisionRationale: 'Feedback loop generated 5 ideas. Winning patterns: ugc_reels, apartment_pain_point, convenience_angle. Ideas avoid ev_road_trip and monsoon_ev (declining).', humanOverridden: false },
      { createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), actionType: 'idea_demoted_stale_trend', decisionRationale: 'Idea "EV Road Trip Delhi to Manali" average trend tag score 0.39. Tags: ev_road_trip (0.39), delhi_ncr_ev (0.74). Overall score below 0.5 threshold.', relatedEntityId: ideas[3].id },
      { createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), actionType: 'idea_demoted_stale_trend', decisionRationale: 'Idea "Monsoon EV Driving Tips" average trend tag score 0.31. Tags: monsoon_ev (0.31), apartment_ev_charging (0.82). Score below 0.3 — stale trend warning set, archived.', relatedEntityId: ideas[9].id },
      { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), actionType: 'trend_context_updated', decisionRationale: 'Updated trend context. apartment_ev_charging at 82, tata_ev at 79. Tata.ev partnership press coverage spiked doorstep_charging to 76. Competitor analysis: no competitor owning the apartment-dweller angle — lean in.', relatedEntityId: latestTrendContext.id },
      { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), actionType: 'creative_selected', decisionRationale: 'Creative for "Van at Your Doorstep" approved. Human edited version selected. Strong match with rising doorstep_charging and tata_ev trends. Cinematic style approved for this angle.', relatedEntityId: creative2.id },
      { createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), actionType: 'post_published', decisionRationale: `Post ${post2.id} published to meta via stub adapter. External ID: act_123456789_post_002`, relatedEntityId: post2.id },
      { createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000), actionType: 'idea_generated', decisionRationale: 'Manual generation triggered with nudge: "focus on new Tata EV buyers in NCR apartments". 5 ideas created referencing tata_ev (79) and apartment_ev_charging (82) trends.', humanOverridden: false },
      { createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000), actionType: 'post_paused', decisionRationale: `Post ${post1.id} paused due to critical fatigue signal: frequency 3.7, ROAS dropped 35% from peak 3.8.`, relatedEntityId: post1.id, humanOverridden: true, humanOverrideReason: 'Decided to reduce budget rather than pause entirely — still driving some leads', outcome: 'pending' },
      { createdAt: new Date(), actionType: 'brief_written', decisionRationale: 'Creative brief written for "₹3.5 Per Km — The Real Math" — UGC style, captions required, include real monthly savings figure, show Hopcharge app UI in second half.', relatedEntityId: ideas[2].id, outcome: 'pending' },
    ],
  })

  console.log('Created 10 agent actions')
  console.log('Seed complete!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
