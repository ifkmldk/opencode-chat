export * as MapsCategory from "./categories.js"

// fork: place categories as OpenStreetMap tag selectors, plus the Indonesian and English words people use for them.
// Category searches ("rumah sakit", "tempat wisata", "kantor") must go to Overpass by tag; Nominatim free text
// matches these words against names and returns warungs or shops abroad.

export type Kind =
  | "office"
  | "hotel"
  | "attraction"
  | "hospital"
  | "clinic"
  | "mall"
  | "restaurant"
  | "cafe"
  | "school"
  | "university"
  | "mosque"
  | "church"
  | "pharmacy"
  | "bank"
  | "atm"
  | "park"
  | "station"
  | "bus_stop"
  | "supermarket"
  | "gas_station"
  | "parking"
  | "coworking"

/**
 * Overpass selectors without brackets, OR-ed: "key" (any value), "key=value", "key=a|b" (alternatives); "+" ANDs
 * filters inside one selector ("amenity=place_of_worship+religion=muslim").
 */
const table: Record<Kind, { readonly tags: readonly string[]; readonly words: readonly string[] }> = {
  office: {
    // building=company is how many Indonesian head offices are mapped ("Kompas Gramedia", Palmerah).
    tags: ["office", "building=office|commercial|company"],
    words: [
      "kantor",
      "perkantoran",
      "gedung kantor",
      "kantor pusat",
      "perusahaan",
      "office",
      "offices",
      "office building",
      "company",
      "companies",
      "headquarters",
      "head office",
      "hq",
    ],
  },
  hotel: {
    tags: ["tourism=hotel|guest_house|hostel|motel|apartment"],
    words: [
      "hotel",
      "hotels",
      "penginapan",
      "losmen",
      "homestay",
      "home stay",
      "guest house",
      "guesthouse",
      "hostel",
      "motel",
      "wisma",
      "inn",
      "resort",
      "akomodasi",
      "accommodation",
      "lodging",
      "tempat menginap",
      "tempat nginap",
    ],
  },
  attraction: {
    tags: ["tourism=attraction|museum|theme_park|zoo|viewpoint|gallery|aquarium", "leisure=park|water_park|garden"],
    words: [
      "wisata",
      "tempat wisata",
      "objek wisata",
      "obyek wisata",
      "destinasi",
      "destinasi wisata",
      "tujuan wisata",
      "tempat rekreasi",
      "rekreasi",
      "tempat jalan jalan",
      "jalan jalan",
      "tourist attraction",
      "tourist attractions",
      "attraction",
      "attractions",
      "sightseeing",
      "things to do",
      "landmark",
      "museum",
      "taman hiburan",
      "theme park",
      "kebun binatang",
      "zoo",
      "galeri",
      "gallery",
      "akuarium",
      "aquarium",
      "taman rekreasi",
      "waterpark",
      "water park",
      "kolam renang umum",
    ],
  },
  hospital: {
    tags: ["amenity=hospital", "healthcare=hospital"],
    words: ["rumah sakit", "rs", "rsu", "rsud", "rsia", "rsup", "rsau", "rspad", "hospital", "hospitals"],
  },
  clinic: {
    tags: ["amenity=clinic|doctors", "healthcare=clinic|centre|doctor"],
    words: [
      "klinik",
      "puskesmas",
      "praktek dokter",
      "praktik dokter",
      "dokter",
      "clinic",
      "clinics",
      "doctor",
      "doctors",
      "health centre",
      "health center",
      "faskes",
      "fasilitas kesehatan",
    ],
  },
  mall: {
    tags: ["shop=mall|department_store"],
    words: [
      "mal",
      "mall",
      "malls",
      "pusat perbelanjaan",
      "pusat belanja",
      "shopping mall",
      "shopping center",
      "shopping centre",
      "department store",
      "itc",
    ],
  },
  restaurant: {
    tags: ["amenity=restaurant|fast_food|food_court"],
    words: [
      "restoran",
      "restaurant",
      "restaurants",
      "resto",
      "rumah makan",
      "tempat makan",
      "warung makan",
      "warteg",
      "kuliner",
      "food court",
      "foodcourt",
      "fast food",
      "eatery",
    ],
  },
  cafe: {
    tags: ["amenity=cafe"],
    words: ["kafe", "cafe", "cafes", "coffee shop", "coffee shops", "kedai kopi", "warkop", "warung kopi", "coffee"],
  },
  school: {
    tags: ["amenity=school"],
    words: ["sekolah", "sd", "smp", "sma", "smk", "madrasah", "school", "schools"],
  },
  university: {
    tags: ["amenity=university|college"],
    words: [
      "universitas",
      "kampus",
      "perguruan tinggi",
      "institut",
      "politeknik",
      "sekolah tinggi",
      "university",
      "universities",
      "college",
      "campus",
    ],
  },
  mosque: {
    tags: ["amenity=place_of_worship+religion=muslim"],
    words: ["masjid", "mesjid", "musholla", "mushola", "musala", "surau", "mosque", "mosques"],
  },
  church: {
    tags: ["amenity=place_of_worship+religion=christian"],
    words: ["gereja", "katedral", "church", "churches", "cathedral"],
  },
  pharmacy: {
    tags: ["amenity=pharmacy", "healthcare=pharmacy", "shop=chemist"],
    words: ["apotek", "apotik", "pharmacy", "pharmacies", "drugstore", "chemist", "toko obat"],
  },
  bank: {
    tags: ["amenity=bank"],
    words: ["bank", "banks", "kantor bank", "kantor cabang bank"],
  },
  atm: {
    tags: ["amenity=atm"],
    words: ["atm", "atms", "anjungan tunai", "cash machine"],
  },
  park: {
    tags: ["leisure=park|garden"],
    words: ["taman", "taman kota", "ruang terbuka hijau", "rth", "park", "parks", "garden", "city park"],
  },
  station: {
    tags: ["railway=station|halt"],
    words: ["stasiun", "stasiun kereta", "train station", "railway station", "station", "stations"],
  },
  bus_stop: {
    tags: ["highway=bus_stop", "amenity=bus_station"],
    words: ["halte", "halte bus", "halte busway", "terminal bus", "bus stop", "bus stops", "bus station", "busway"],
  },
  supermarket: {
    tags: ["shop=supermarket|convenience"],
    words: [
      "supermarket",
      "swalayan",
      "pasar swalayan",
      "hypermarket",
      "minimarket",
      "mini market",
      "convenience store",
      "grocery",
      "groceries",
    ],
  },
  gas_station: {
    tags: ["amenity=fuel"],
    words: ["spbu", "pom bensin", "pombensin", "gas station", "petrol station", "fuel station"],
  },
  parking: {
    tags: ["amenity=parking"],
    words: ["parkir", "tempat parkir", "lahan parkir", "parking", "car park", "parking lot"],
  },
  coworking: {
    tags: ["amenity=coworking_space", "office=coworking"],
    words: ["coworking", "co working", "coworking space", "co working space", "ruang kerja bersama", "shared office"],
  },
}

export const KINDS = Object.keys(table) as readonly Kind[]

export function tags(kind: Kind): readonly string[] {
  return table[kind].tags
}

/** The category a text asks for: "rumah sakit dekat stasiun" → "hospital", "tempat wisata BSD" → "attraction". */
export function fromText(text: string): Kind | undefined {
  return parse(text).kind
}

/**
 * Splits a place request into its category, the name words left over ("RS Siloam" → name "siloam") and the place it
 * is around ("hotel murah dekat Stasiun Serpong" → place "Stasiun Serpong"). Price and quality words are dropped
 * from the name because OSM has no such data.
 */
export function parse(text: string): { kind?: Kind; name: string; place?: string; head: string } {
  const split = text.match(placePattern)
  const place = split?.[2]?.replace(/[?!.,;]+$/, "").trim() || undefined
  // The request without its place part: "hotel murah dekat BSD" → "hotel murah".
  const head = (split ? text.slice(0, split.index) : text).trim()
  const words = normalize(head)
  const match = phrases.find((item) => contains(words, item.words))
  if (!match) {
    // "dekat stasiun serpong ada rumah sakit?": the category comes after the place words.
    const later = phrases.find((item) => item.kind !== "station" && contains(normalize(text), item.words))
    return { kind: later?.kind, name: later ? "" : words.join(" "), place, head }
  }
  const start = words.findIndex((_, index) => entry(words, index, match.words))
  const rest = [...words.slice(0, start), ...words.slice(start + match.words.length)].filter(
    (word) => !filler.has(word) && !/^\d+$/.test(word),
  )
  return { kind: match.kind, name: rest.join(" "), place, head }
}

// "dekat X", "di sekitar X", "near X", "around X", "di X", "in X": the rest of the text is the place.
const placePattern =
  /(?:^|\s)(dekat|deket|dkt|near|nearby|sekitar|di sekitar|disekitar|sekitaran|seputar|around|close to|di dekat|didekat|dari|from|di|in|at)\s+(.+)$/i

// Longest phrases first so "taman hiburan" wins over "taman" and "rumah sakit" over nothing.
const phrases = KINDS.flatMap((kind) => table[kind].words.map((word) => ({ kind, words: normalize(word) }))).toSorted(
  (a, b) => b.words.length - a.words.length || b.words.join(" ").length - a.words.join(" ").length,
)

const filler = new Set([
  "murah",
  "termurah",
  "cheap",
  "cheapest",
  "budget",
  "bagus",
  "terbaik",
  "best",
  "good",
  "top",
  "populer",
  "popular",
  "terkenal",
  "famous",
  "terdekat",
  "nearest",
  "closest",
  "nearby",
  "rekomendasi",
  "recommended",
  "recommendation",
  "yang",
  "the",
  "a",
  "an",
  "of",
  "and",
  "dan",
  "atau",
  "or",
  "for",
  "untuk",
  "buat",
  "cari",
  "carikan",
  "find",
  "list",
  "daftar",
  "semua",
  "all",
  "any",
  "some",
  "beberapa",
  "ada",
  "apa",
  "saja",
  "aja",
  "tempat",
  "buka",
  "open",
  "now",
  "sekarang",
  "jam",
  "24",
  "bintang",
  "star",
  "stars",
  "keluarga",
  "family",
  "anak",
  "kids",
  "bersih",
  "clean",
  "nyaman",
  "comfortable",
  "lengkap",
  "besar",
  "big",
  "kecil",
  "small",
  "baru",
  "new",
  "lokasi",
  "location",
  "area",
  "kawasan",
  "daerah",
])

function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function contains(words: readonly string[], phrase: readonly string[]) {
  return words.some((_, index) => entry(words, index, phrase))
}

function entry(words: readonly string[], index: number, phrase: readonly string[]) {
  return phrase.every((word, offset) => words[index + offset] === word)
}
