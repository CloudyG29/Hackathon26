import type {
  LatLng,
  PlanLeg,
  PlanPriority,
  PlanResult,
  Rank,
  TransportMode,
} from '@hackathon26/shared';

/**
 * Offline journey fixtures over a real Tshwane corridor.
 *
 * Every leg below is copied from data/seed/legs.json (CSIR taxi survey, Dec
 * 2018 - the same data the live Supabase routing tables are seeded from):
 * same leg ids, rank ids, fares, durations, distances and surveyed road
 * geometry. Paths are decimated to <= 48 points each so the map lines stay
 * smooth without bloating the app bundle.
 *
 * Corridor (all ranks from the 2021 facility survey):
 *   Belle Ombre (Marabastad) -> Denneboom -> Hammanskraal Station
 *   First Street <-> Phomolong <-> Mphalane (Atteridgeville / Saulsville)
 *   Denneboom <-> KwaMhlanga (single long-distance taxi, ~56 km, R40)
 *
 * Deliberately excluded: leg-cr0084 (Denneboom <-> Phomolong) - its surveyed
 * track ends 30-37 km from the Phomolong rank anchor (one of the importer's
 * rank-placement warnings), so it would draw a line to the wrong place.
 *
 * planJourney() falls back to buildFixturePlan() whenever the API is
 * unreachable, so the demo keeps working offline and still honours the
 * cheapest / fastest / easiest (fewest taxis) choice. Keep the numbers in
 * sync with data/seed.
 */

/** Compact surveyed-geometry point, matching the PlanLeg wire shape. */
const p = (lat: number, lng: number): LatLng => ({ lat, lng });

/** The corridor's ranks, trimmed from data/seed/ranks.json. */
export const RANKS: Rank[] = [
  {
    id: 'rank-f25',
    name: 'Belle Ombre',
    area: 'Marabastad, Pretoria',
    location: { latitude: -25.73851, longitude: 28.18056 },
    modes: ['mini_bus_taxi'],
    kind: 'formal',
  },
  {
    id: 'rank-denneboom-temporary-taxi-rank',
    name: 'Denneboom Temporary Taxi Rank',
    area: 'Mamelodi, City of Tshwane',
    location: { latitude: -25.71765, longitude: 28.33972 },
    modes: ['long_distance_taxi', 'mini_bus_taxi'],
    kind: 'formal',
  },
  {
    id: 'rank-f9',
    name: 'Hammanskraal Station',
    area: 'Hammanskraal, Pretoria',
    location: { latitude: -25.40408, longitude: 28.28212 },
    modes: ['mini_bus_taxi'],
    kind: 'formal',
  },
  {
    id: 'rank-kwamhlanga-taxi-rank',
    name: 'KwaMhlanga Taxi Rank',
    area: 'Kameelpoortnek, Mpumalanga',
    location: { latitude: -25.46343, longitude: 28.6206 },
    modes: ['mini_bus_taxi'],
    kind: 'formal',
  },
  {
    id: 'rank-f71',
    name: 'First Street',
    area: 'Ladium, Pretoria',
    location: { latitude: -25.78727, longitude: 28.10531 },
    modes: ['mini_bus_taxi'],
    kind: 'informal',
  },
  {
    id: 'rank-f57',
    name: 'Phomolong',
    area: 'Atteridgeville, Pretoria',
    location: { latitude: -25.78559, longitude: 28.04376 },
    modes: ['mini_bus_taxi'],
    kind: 'informal',
  },
  {
    id: 'rank-mphalane-taxi-rank',
    name: 'Mphalane Taxi Rank',
    area: 'Saulsville, City of Tshwane',
    location: { latitude: -25.78062, longitude: 28.05705 },
    modes: ['mini_bus_taxi'],
    kind: 'formal',
  },
];

const RANK_BY_ID = new Map(RANKS.map((rank) => [rank.id, rank]));

/** A seeded leg carrying its real surveyed path. */
interface LegTemplate {
  id: string;
  mode: TransportMode;
  fromRankId: string;
  toRankId: string;
  fareZar: number;
  estimatedMinutes: number;
  distanceKm: number;
  reliability: number;
  departsWhenFull: boolean;
  path: LatLng[];
}

const LEG_TEMPLATES: LegTemplate[] = [
  {
    id: 'leg-cr0097-return',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-f25',
    toRankId: 'rank-denneboom-temporary-taxi-rank',
    fareZar: 18,
    estimatedMinutes: 43,
    distanceKm: 20,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0097 return: Belle Ombre -> Denneboom (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.73841, 28.17705), p(-25.73989, 28.17665), p(-25.73955, 28.18254), p(-25.73922, 28.18728),
      p(-25.73908, 28.19081), p(-25.73933, 28.19481), p(-25.73792, 28.19638), p(-25.73694, 28.198),
      p(-25.73445, 28.19943), p(-25.73305, 28.20261), p(-25.73233, 28.2046), p(-25.72949, 28.20432),
      p(-25.72636, 28.2038), p(-25.71906, 28.20261), p(-25.71818, 28.20561), p(-25.71777, 28.20867),
      p(-25.71735, 28.21165), p(-25.71692, 28.21491), p(-25.71651, 28.21821), p(-25.71613, 28.22089),
      p(-25.71406, 28.22258), p(-25.71145, 28.22489), p(-25.7093, 28.22665), p(-25.70728, 28.22841),
      p(-25.70644, 28.22919), p(-25.7045, 28.24283), p(-25.70752, 28.24896), p(-25.70888, 28.26108),
      p(-25.71118, 28.26114), p(-25.71132, 28.2644), p(-25.71152, 28.26801), p(-25.71114, 28.27145),
      p(-25.71111, 28.27478), p(-25.71209, 28.28001), p(-25.71263, 28.28321), p(-25.71378, 28.28832),
      p(-25.71753, 28.30214), p(-25.71788, 28.30424), p(-25.7178, 28.30839), p(-25.717, 28.31472),
      p(-25.71685, 28.3175), p(-25.71645, 28.32069), p(-25.71648, 28.32379), p(-25.71627, 28.33219),
      p(-25.71653, 28.33462), p(-25.71783, 28.33907), p(-25.71823, 28.34149), p(-25.71818, 28.34353),
    ],
  },
  {
    id: 'leg-cr0102-out',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-denneboom-temporary-taxi-rank',
    toRankId: 'rank-f9',
    fareZar: 30,
    estimatedMinutes: 134,
    distanceKm: 62.6,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0102 out: Denneboom -> Hammanskraal Station (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.71982, 28.34434), p(-25.71678, 28.33503), p(-25.72538, 28.3325), p(-25.73724, 28.32997),
      p(-25.74569, 28.32822), p(-25.7531, 28.32653), p(-25.75296, 28.3163), p(-25.75263, 28.3018),
      p(-25.74583, 28.29197), p(-25.74081, 28.27643), p(-25.74027, 28.2654), p(-25.74177, 28.25437),
      p(-25.74404, 28.24445), p(-25.74594, 28.21745), p(-25.74683, 28.20395), p(-25.75218, 28.19806),
      p(-25.75688, 28.18646), p(-25.75101, 28.18597), p(-25.7422, 28.18524), p(-25.74023, 28.19244),
      p(-25.73653, 28.2008), p(-25.72886, 28.2042), p(-25.71859, 28.20253), p(-25.70738, 28.20069),
      p(-25.70103, 28.19967), p(-25.69098, 28.19828), p(-25.68509, 28.19169), p(-25.67656, 28.19449),
      p(-25.66399, 28.19215), p(-25.65523, 28.19082), p(-25.64644, 28.19463), p(-25.63661, 28.19938),
      p(-25.62702, 28.2041), p(-25.60185, 28.22157), p(-25.58834, 28.23165), p(-25.57713, 28.23851),
      p(-25.56508, 28.24167), p(-25.55152, 28.24675), p(-25.53059, 28.25092), p(-25.51226, 28.25445),
      p(-25.50121, 28.25776), p(-25.49152, 28.26189), p(-25.46653, 28.27035), p(-25.45035, 28.27235),
      p(-25.43034, 28.27871), p(-25.41812, 28.28111), p(-25.40885, 28.28062), p(-25.40468, 28.28329),
    ],
  },
  {
    id: 'leg-cr0102-return',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-f9',
    toRankId: 'rank-denneboom-temporary-taxi-rank',
    fareZar: 30,
    estimatedMinutes: 117,
    distanceKm: 54.7,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0102 return: Hammanskraal Station -> Denneboom (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.40477, 28.28337), p(-25.41478, 28.28166), p(-25.42247, 28.28039), p(-25.43564, 28.2774),
      p(-25.44898, 28.27268), p(-25.45889, 28.27122), p(-25.48865, 28.26279), p(-25.49471, 28.26109),
      p(-25.50404, 28.2563), p(-25.52204, 28.2525), p(-25.53059, 28.25092), p(-25.54969, 28.24723),
      p(-25.5637, 28.24234), p(-25.57164, 28.23998), p(-25.58353, 28.23494), p(-25.59916, 28.22354),
      p(-25.61633, 28.21127), p(-25.62855, 28.20312), p(-25.63569, 28.19982), p(-25.64358, 28.19603),
      p(-25.65203, 28.19183), p(-25.65827, 28.19088), p(-25.67372, 28.19454), p(-25.68268, 28.19359),
      p(-25.68654, 28.18976), p(-25.69281, 28.18668), p(-25.70094, 28.18596), p(-25.70756, 28.18516),
      p(-25.71513, 28.18485), p(-25.722, 28.18705), p(-25.72733, 28.18867), p(-25.73435, 28.18754),
      p(-25.73919, 28.18786), p(-25.74597, 28.19541), p(-25.74356, 28.20836), p(-25.7428, 28.24097),
      p(-25.74129, 28.25471), p(-25.73834, 28.26419), p(-25.73732, 28.26989), p(-25.73366, 28.27981),
      p(-25.73277, 28.28986), p(-25.73293, 28.296), p(-25.73323, 28.30659), p(-25.73418, 28.31327),
      p(-25.72917, 28.32), p(-25.7213, 28.33149), p(-25.71638, 28.3338), p(-25.71816, 28.34267),
    ],
  },
  {
    id: 'leg-cr0097-out',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-denneboom-temporary-taxi-rank',
    toRankId: 'rank-f25',
    fareZar: 18,
    estimatedMinutes: 48,
    distanceKm: 22.6,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0097 out: Denneboom -> Belle Ombre (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.71996, 28.34451), p(-25.71868, 28.34497), p(-25.7181, 28.33946), p(-25.7166, 28.33401),
      p(-25.71854, 28.33289), p(-25.72292, 28.32935), p(-25.72575, 28.32518), p(-25.72828, 28.32154),
      p(-25.73261, 28.31625), p(-25.73434, 28.31412), p(-25.73637, 28.31255), p(-25.73945, 28.31031),
      p(-25.74202, 28.30455), p(-25.74271, 28.3012), p(-25.74349, 28.29851), p(-25.74467, 28.29499),
      p(-25.74588, 28.29202), p(-25.74495, 28.29085), p(-25.74226, 28.28757), p(-25.7415, 28.28497),
      p(-25.74081, 28.27643), p(-25.74036, 28.27061), p(-25.74021, 28.26705), p(-25.74038, 28.26372),
      p(-25.74161, 28.25597), p(-25.74196, 28.25243), p(-25.74303, 28.2494), p(-25.74404, 28.24445),
      p(-25.74438, 28.23954), p(-25.7449, 28.23222), p(-25.74556, 28.22231), p(-25.74594, 28.21744),
      p(-25.74626, 28.21217), p(-25.74694, 28.20243), p(-25.74719, 28.20042), p(-25.74936, 28.19915),
      p(-25.7517, 28.19816), p(-25.75674, 28.19483), p(-25.75688, 28.18646), p(-25.75557, 28.18473),
      p(-25.75503, 28.18226), p(-25.75822, 28.1819), p(-25.7624, 28.18241), p(-25.75828, 28.18167),
      p(-25.75491, 28.18139), p(-25.74107, 28.18024), p(-25.74177, 28.17684), p(-25.74135, 28.1754),
    ],
  },
  {
    id: 'leg-cr0003-return',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-f71',
    toRankId: 'rank-f57',
    fareZar: 12,
    estimatedMinutes: 23,
    distanceKm: 10.6,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0003 return: First Street -> Phomolong (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.78722, 28.10542), p(-25.78727, 28.10645), p(-25.78542, 28.10619), p(-25.78507, 28.10916),
      p(-25.78753, 28.11094), p(-25.78832, 28.11151), p(-25.7882, 28.11257), p(-25.78632, 28.11349),
      p(-25.78516, 28.1141), p(-25.78379, 28.11474), p(-25.78249, 28.11497), p(-25.78105, 28.11474),
      p(-25.77979, 28.11441), p(-25.77778, 28.11464), p(-25.77573, 28.1156), p(-25.77523, 28.1158),
      p(-25.77399, 28.11619), p(-25.77239, 28.1162), p(-25.77075, 28.11465), p(-25.77118, 28.11367),
      p(-25.77178, 28.11221), p(-25.77236, 28.1101), p(-25.77315, 28.10725), p(-25.77355, 28.10574),
      p(-25.77367, 28.1049), p(-25.77362, 28.103), p(-25.77383, 28.10112), p(-25.77417, 28.09897),
      p(-25.77441, 28.09743), p(-25.77467, 28.09586), p(-25.77494, 28.09406), p(-25.77485, 28.092),
      p(-25.7747, 28.0901), p(-25.77558, 28.08338), p(-25.7763, 28.07828), p(-25.7766, 28.07593),
      p(-25.77691, 28.0737), p(-25.77728, 28.07099), p(-25.77782, 28.06715), p(-25.77857, 28.06517),
      p(-25.77961, 28.0627), p(-25.78056, 28.06049), p(-25.78073, 28.05757), p(-25.78052, 28.05514),
      p(-25.78005, 28.05363), p(-25.78116, 28.05223), p(-25.7828, 28.05024), p(-25.78524, 28.04407),
    ],
  },
  {
    id: 'leg-cr0001-out',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-f57',
    toRankId: 'rank-mphalane-taxi-rank',
    fareZar: 10,
    estimatedMinutes: 3,
    distanceKm: 1.5,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0001 out: Phomolong -> Mphalane (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.78546, 28.04388), p(-25.78515, 28.04449), p(-25.78355, 28.0484), p(-25.7828, 28.05022),
      p(-25.78223, 28.05116), p(-25.78107, 28.05231), p(-25.78061, 28.05277), p(-25.78046, 28.05296),
      p(-25.78034, 28.05318), p(-25.78015, 28.05345), p(-25.78006, 28.05368), p(-25.78026, 28.05413),
      p(-25.78052, 28.05514), p(-25.78058, 28.05549), p(-25.78069, 28.057), p(-25.78062, 28.05705),
    ],
  },
  {
    id: 'leg-cr0001-return',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-mphalane-taxi-rank',
    toRankId: 'rank-f57',
    fareZar: 10,
    estimatedMinutes: 3,
    distanceKm: 1.5,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0001 return: Mphalane -> Phomolong (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.78076, 28.05709), p(-25.78058, 28.05548), p(-25.78053, 28.05514), p(-25.78027, 28.05415),
      p(-25.78014, 28.05377), p(-25.78004, 28.05357), p(-25.78034, 28.05317), p(-25.78046, 28.05295),
      p(-25.78061, 28.05277), p(-25.78221, 28.05118), p(-25.78282, 28.05023), p(-25.78356, 28.04836),
      p(-25.78511, 28.04461), p(-25.78554, 28.04353), p(-25.78559, 28.04348),
    ],
  },
  {
    id: 'leg-cr0003-out',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-mphalane-taxi-rank',
    toRankId: 'rank-f71',
    fareZar: 12,
    estimatedMinutes: 20,
    distanceKm: 9.3,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0003 out: Mphalane -> First Street (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.78059, 28.0571), p(-25.78056, 28.06049), p(-25.77911, 28.0639), p(-25.77807, 28.06635),
      p(-25.77746, 28.06961), p(-25.77712, 28.0722), p(-25.77679, 28.07466), p(-25.77649, 28.07667),
      p(-25.77627, 28.07837), p(-25.77587, 28.08126), p(-25.77501, 28.08776), p(-25.77473, 28.08972),
      p(-25.77472, 28.09085), p(-25.77485, 28.092), p(-25.77498, 28.09354), p(-25.77369, 28.10207),
      p(-25.77365, 28.1035), p(-25.7736, 28.10537), p(-25.77321, 28.10701), p(-25.77289, 28.10819),
      p(-25.77231, 28.11028), p(-25.77187, 28.11186), p(-25.77157, 28.11278), p(-25.77117, 28.11368),
      p(-25.77091, 28.11418), p(-25.77064, 28.11594), p(-25.77294, 28.11624), p(-25.77395, 28.1162),
      p(-25.77526, 28.11579), p(-25.77747, 28.11476), p(-25.77867, 28.11438), p(-25.77977, 28.11441),
      p(-25.78072, 28.11465), p(-25.78186, 28.11495), p(-25.78318, 28.11491), p(-25.78446, 28.11444),
      p(-25.78572, 28.11382), p(-25.78716, 28.11308), p(-25.78914, 28.1121), p(-25.78743, 28.11085),
      p(-25.7867, 28.11033), p(-25.78601, 28.10976), p(-25.78638, 28.10869), p(-25.78705, 28.10812),
      p(-25.78807, 28.1066), p(-25.78833, 28.10456), p(-25.78778, 28.10523), p(-25.78733, 28.10514),
    ],
  },
  {
    id: 'leg-cr0080-out',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-denneboom-temporary-taxi-rank',
    toRankId: 'rank-kwamhlanga-taxi-rank',
    fareZar: 40,
    estimatedMinutes: 120,
    distanceKm: 56.1,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0080 out: Denneboom -> KwaMhlanga (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.71729, 28.33756), p(-25.71832, 28.3472), p(-25.71888, 28.35897), p(-25.71869, 28.36538),
      p(-25.71573, 28.37143), p(-25.70988, 28.38197), p(-25.70373, 28.39233), p(-25.69898, 28.39953),
      p(-25.69789, 28.41383), p(-25.69362, 28.41955), p(-25.68583, 28.41727), p(-25.6796, 28.41997),
      p(-25.67297, 28.42504), p(-25.667, 28.43276), p(-25.66018, 28.43925), p(-25.65708, 28.44618),
      p(-25.65286, 28.45769), p(-25.64745, 28.46677), p(-25.64383, 28.47288), p(-25.64123, 28.48516),
      p(-25.63528, 28.48847), p(-25.62882, 28.49202), p(-25.62111, 28.49444), p(-25.6145, 28.49623),
      p(-25.60501, 28.5016), p(-25.59812, 28.50696), p(-25.5917, 28.50964), p(-25.58543, 28.51194),
      p(-25.57926, 28.5142), p(-25.57313, 28.51645), p(-25.56701, 28.5187), p(-25.5609, 28.52092),
      p(-25.55486, 28.52313), p(-25.54797, 28.52584), p(-25.54008, 28.53051), p(-25.52962, 28.53066),
      p(-25.51772, 28.52458), p(-25.51113, 28.53077), p(-25.50608, 28.53695), p(-25.5012, 28.54662),
      p(-25.49582, 28.55768), p(-25.49287, 28.56665), p(-25.49013, 28.57468), p(-25.48442, 28.58783),
      p(-25.4801, 28.59784), p(-25.47673, 28.60336), p(-25.46791, 28.61464), p(-25.46343, 28.6206),
    ],
  },
  {
    id: 'leg-cr0080-return',
    mode: 'mini_bus_taxi',
    fromRankId: 'rank-kwamhlanga-taxi-rank',
    toRankId: 'rank-denneboom-temporary-taxi-rank',
    fareZar: 40,
    estimatedMinutes: 119,
    distanceKm: 55.7,
    reliability: 0.8,
    departsWhenFull: true,
    // cr0080 return: KwaMhlanga -> Denneboom (CSIR survey track, decimated to <= 48 points).
    path: [
      p(-25.46343, 28.6206), p(-25.47371, 28.60729), p(-25.47808, 28.60162), p(-25.48132, 28.59503),
      p(-25.48597, 28.58423), p(-25.49119, 28.57191), p(-25.49349, 28.56465), p(-25.49649, 28.55613),
      p(-25.5012, 28.54662), p(-25.50521, 28.53866), p(-25.51113, 28.53077), p(-25.51772, 28.52458),
      p(-25.52466, 28.52881), p(-25.53312, 28.53196), p(-25.54031, 28.53037), p(-25.54746, 28.52614),
      p(-25.55517, 28.52303), p(-25.56174, 28.52061), p(-25.5686, 28.51811), p(-25.5751, 28.51572),
      p(-25.59763, 28.50729), p(-25.60851, 28.49887), p(-25.6156, 28.49593), p(-25.62229, 28.49412),
      p(-25.62845, 28.49221), p(-25.63612, 28.48839), p(-25.64202, 28.48179), p(-25.64356, 28.47388),
      p(-25.64695, 28.46729), p(-25.65241, 28.4589), p(-25.65645, 28.44824), p(-25.65856, 28.44147),
      p(-25.6626, 28.43697), p(-25.66878, 28.43042), p(-25.67394, 28.42422), p(-25.68041, 28.41938),
      p(-25.68477, 28.41751), p(-25.69136, 28.41867), p(-25.69729, 28.42), p(-25.6975, 28.4066),
      p(-25.69878, 28.4), p(-25.7046, 28.39118), p(-25.70996, 28.38202), p(-25.71506, 28.37301),
      p(-25.71965, 28.36357), p(-25.7183, 28.35638), p(-25.71839, 28.34542), p(-25.71804, 28.33891),
    ],
  },
];

/**
 * Ordered leg chains that span the corridor. Slicing any chain between two
 * ranks produces a plausible journey for that pair, exactly like the live
 * planner walking the same seed legs.
 */
const TRUNKS: string[][] = [
  // Pretoria CBD -> far north: one change at Denneboom.
  ['leg-cr0097-return', 'leg-cr0102-out'],
  ['leg-cr0102-return', 'leg-cr0097-out'],
  // Atteridgeville side: First Street <-> Mphalane through Phomolong.
  ['leg-cr0003-return', 'leg-cr0001-out'],
  ['leg-cr0001-out', 'leg-cr0003-out'],
  ['leg-cr0001-return'],
  // Far north-east, a single long-distance taxi.
  ['leg-cr0080-out'],
  ['leg-cr0080-return'],
];

/**
 * Builds a plan over the seeded corridor for the requested rank pair, in the
 * exact POST /routes/plan wire shape and honouring the same priority choice.
 * Unreachable or reverse-direction pairs return null - the same meaning as
 * the API's 404 "no route found".
 */
export function buildFixturePlan(
  fromRankId: string,
  toRankId: string,
  priority: PlanPriority = 'cheapest',
): PlanResult | null {
  const options: RouteOptionLite[] = TRUNKS.map((trunk) => sliceTrunk(trunk, fromRankId, toRankId))
    .filter((option): option is RouteOptionLite => option !== null);
  if (options.length === 0) return null;

  options.sort((a, b) => {
    if (priority === 'fastest') {
      return a.totalMinutes - b.totalMinutes || a.totalFareZar - b.totalFareZar;
    }
    if (priority === 'easiest') {
      return (
        a.legs.length - b.legs.length ||
        a.totalMinutes - b.totalMinutes ||
        a.totalFareZar - b.totalFareZar
      );
    }
    return a.totalFareZar - b.totalFareZar || a.totalMinutes - b.totalMinutes;
  });
  const best = options[0]!;

  const legs: PlanLeg[] = best.legs.map((leg) => {
    const from = RANK_BY_ID.get(leg.fromRankId);
    const to = RANK_BY_ID.get(leg.toRankId);
    return {
      fromRankId: leg.fromRankId,
      fromName: from?.name ?? leg.fromRankId,
      toRankId: leg.toRankId,
      toName: to?.name ?? leg.toRankId,
      path: leg.path,
      fareZar: leg.fareZar,
    };
  });

  return {
    legs,
    totalFareZar: best.totalFareZar,
    legCount: legs.length,
  };
}

/** Internal slice of a trunk: seeded leg templates plus the totals we display. */
interface RouteOptionLite {
  legs: LegTemplate[];
  totalFareZar: number;
  totalMinutes: number;
}

/** Slices one trunk between the origin and destination ranks, if it serves both in order. */
function sliceTrunk(trunk: string[], fromRankId: string, toRankId: string): RouteOptionLite | null {
  const legs = trunk
    .map((id) => LEG_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is LegTemplate => Boolean(template));
  if (legs.length === 0) return null;

  const rankSequence = [legs[0]!.fromRankId, ...legs.map((leg) => leg.toRankId)];
  const start = rankSequence.indexOf(fromRankId);
  const end = rankSequence.indexOf(toRankId);
  if (start === -1 || end === -1 || end <= start) return null;

  const chosen = legs.slice(start, end);
  return {
    legs: chosen,
    totalFareZar: chosen.reduce((sum, leg) => sum + leg.fareZar, 0),
    totalMinutes: chosen.reduce((sum, leg) => sum + leg.estimatedMinutes, 0),
  };
}
