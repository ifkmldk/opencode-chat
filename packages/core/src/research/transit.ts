export type Station = { name: string; latitude: number; longitude: number }

// Koridor KRL Rangkasbitung: Tanah Abang → Rangkasbitung (~19 stasiun).
// Koordinat kasar Jabodetabek; di-resolve ulang via geocode saat dipakai bila perlu.
export const RANGKASBITUNG_STATIONS: Station[] = [
  { name: "Stasiun Tanah Abang", latitude: -6.1862, longitude: 106.8124 },
  { name: "Stasiun Palmerah", latitude: -6.1897, longitude: 106.7933 },
  { name: "Stasiun Kebayoran", latitude: -6.2387, longitude: 106.7832 },
  { name: "Stasiun Pondok Ranji", latitude: -6.2689, longitude: 106.7498 },
  { name: "Stasiun Jurangmangu", latitude: -6.2808, longitude: 106.7278 },
  { name: "Stasiun Sudimara", latitude: -6.2919, longitude: 106.7107 },
  { name: "Stasiun Rawa Buntu", latitude: -6.3046, longitude: 106.69 },
  { name: "Stasiun Serpong", latitude: -6.3211, longitude: 106.6697 },
  { name: "Stasiun Cisauk", latitude: -6.3317, longitude: 106.6464 },
  { name: "Stasiun Cicayur", latitude: -6.3449, longitude: 106.6199 },
  { name: "Stasiun Parung Panjang", latitude: -6.3587, longitude: 106.5756 },
  { name: "Stasiun Cilejit", latitude: -6.3736, longitude: 106.5467 },
  { name: "Stasiun Daru", latitude: -6.3833, longitude: 106.5086 },
  { name: "Stasiun Tenjo", latitude: -6.3861, longitude: 106.4733 },
  { name: "Stasiun Tigaraksa", latitude: -6.3694, longitude: 106.4417 },
  { name: "Stasiun Cikoya", latitude: -6.3542, longitude: 106.4167 },
  { name: "Stasiun Maja", latitude: -6.3392, longitude: 106.3894 },
  { name: "Stasiun Citeras", latitude: -6.3317, longitude: 106.3567 },
  { name: "Stasiun Rangkasbitung", latitude: -6.3553, longitude: 106.25 },
]

export function nearestStation(point: { latitude: number; longitude: number }, stations: Station[] = RANGKASBITUNG_STATIONS): { station: Station; meters: number } {
  let best = stations[0]!
  let bestM = haversineM(point, best)
  for (const s of stations) {
    const m = haversineM(point, s)
    if (m < bestM) {
      bestM = m
      best = s
    }
  }
  return { station: best, meters: bestM }
}

function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180
  const la1 = (a.latitude * Math.PI) / 180
  const la2 = (b.latitude * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const __test = { RANGKASBITUNG_STATIONS, nearestStation }
