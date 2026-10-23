// `:rocket:` -> 🚀, from the same table the website uses.
//
// COPIED, not re-typed, and copied whole. The point of a shortcode is that one document reads
// the same in both places; a table that is 90% of the other one is a document that renders
// differently in the app, for the names nobody thought to check.
//
// The source of truth is BCW/BCWEB/apps/web/src/markdown/emoji.js. `scripts/check-emoji-sync.mjs`
// fails when the two drift, so edit THAT file and re-run the copy — never this one.
//
// 381 names. Unicode emoji pasted straight into a document have always worked; the
// shortcode is what people actually type, because the keyboard has no 🚀 on it.

/** name -> character. */
export const EMOJI: Record<string, string> = {
  // ── Faces ──
  smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', laughing: '😆', satisfied: '😆',
  sweat_smile: '😅', joy: '😂', rofl: '🤣', slightly_smiling_face: '🙂', upside_down_face: '🙃',
  wink: '😉', blush: '😊', innocent: '😇', heart_eyes: '😍', kissing_heart: '😘',
  yum: '😋', stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜', zany_face: '🤪',
  sunglasses: '😎', nerd_face: '🤓', thinking: '🤔', thinking_face: '🤔', face_with_monocle: '🧐',
  neutral_face: '😐', expressionless: '😑', no_mouth: '😶', smirk: '😏', unamused: '😒',
  roll_eyes: '🙄', grimacing: '😬', lying_face: '🤥', relieved: '😌', pensive: '😔',
  sleepy: '😪', sleeping: '😴', mask: '😷', face_with_thermometer: '🤒', nauseated_face: '🤢',
  exploding_head: '🤯', hot_face: '🥵', cold_face: '🥶', woozy_face: '🥴', dizzy_face: '😵',
  cowboy_hat_face: '🤠', partying_face: '🥳', disguised_face: '🥸', confused: '😕',
  worried: '😟', frowning_face: '🙁', open_mouth: '😮', hushed: '😯', astonished: '😲',
  flushed: '😳', pleading_face: '🥺', frowning: '😦', anguished: '😧', fearful: '😨',
  cold_sweat: '😰', cry: '😢', sob: '😭', scream: '😱', confounded: '😖', persevere: '😣',
  disappointed: '😞', sweat: '😓', weary: '😩', tired_face: '😫', yawning_face: '🥱',
  triumph: '😤', rage: '😡', angry: '😠', cursing_face: '🤬', smiling_imp: '😈', imp: '👿',
  skull: '💀', skull_and_crossbones: '☠️', clown_face: '🤡', ghost: '👻', alien: '👽',
  robot: '🤖', poop: '💩', see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊',

  // ── Hands and people ──
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎',
  ok_hand: '👌', pinching_hand: '🤏', v: '✌️', crossed_fingers: '🤞', metal: '🤘',
  call_me_hand: '🤙', point_left: '👈', point_right: '👉', point_up_2: '👆', point_down: '👇',
  raised_hand: '✋', wave: '👋', clap: '👏', raised_hands: '🙌', open_hands: '👐',
  handshake: '🤝', pray: '🙏', muscle: '💪', writing_hand: '✍️', nail_care: '💅',
  eyes: '👀', brain: '🧠', ear: '👂',
  bow: '🙇', shrug: '🤷', facepalm: '🤦', tada_person: '🙋', ok_person: '🙆', no_good: '🙅',
  detective: '🕵️', technologist: '🧑‍💻', construction_worker: '👷', rocket_scientist: '🧑‍🚀',

  // ── Hearts and marks ──
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙',
  purple_heart: '💜', black_heart: '🖤', white_heart: '🤍', broken_heart: '💔',
  two_hearts: '💕', sparkling_heart: '💖', heartpulse: '💗', cupid: '💘',
  star: '⭐', star2: '🌟', stars: '🌠', sparkles: '✨', dizzy: '💫', boom: '💥', collision: '💥',
  fire: '🔥', zap: '⚡', snowflake: '❄️', droplet: '💧', ocean: '🌊', rainbow: '🌈',
  sunny: '☀️', cloud: '☁️', rain_cloud: '🌧️', umbrella: '☔', moon: '🌙', earth_africa: '🌍',

  // ── Status: what a changelog and a review actually use ──
  white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️',
  x: '❌', negative_squared_cross_mark: '❎', heavy_multiplication_x: '✖️',
  warning: '⚠️', no_entry: '⛔', no_entry_sign: '🚫', bangbang: '‼️', interrobang: '⁉️',
  question: '❓', grey_question: '❔', exclamation: '❗', grey_exclamation: '❕',
  bulb: '💡', bell: '🔔', no_bell: '🔕', mega: '📣', loudspeaker: '📢',
  hourglass: '⌛', hourglass_flowing_sand: '⏳', watch: '⌚', alarm_clock: '⏰', stopwatch: '⏱️',
  recycle: '♻️', arrows_counterclockwise: '🔄', arrow_right: '➡️', arrow_left: '⬅️',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_right_hook: '↪️', leftwards_arrow_with_hook: '↩️',
  green_circle: '🟢', yellow_circle: '🟡', red_circle: '🔴', large_blue_circle: '🔵',
  black_circle: '⚫', white_circle: '⚪', orange_circle: '🟠', purple_circle: '🟣',

  // ── Objects a technical post reaches for ──
  rocket: '🚀', tada: '🎉', confetti_ball: '🎊', gift: '🎁', balloon: '🎈', trophy: '🏆',
  medal: '🏅', crown: '👑', gem: '💎', moneybag: '💰', dollar: '💵', credit_card: '💳',
  package: '📦', file_folder: '📁', open_file_folder: '📂', page_facing_up: '📄',
  clipboard: '📋', memo: '📝', pencil2: '✏️', paperclip: '📎', pushpin: '📌', round_pushpin: '📍',
  bookmark: '🔖', label: '🏷️', books: '📚', book: '📖', notebook: '📓', ledger: '📒',
  newspaper: '📰', calendar: '📅', date: '📆', chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉', bar_chart: '📊', clipboard_chart: '🗒️',
  computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️', printer: '🖨️', mouse_three_button: '🖱️',
  floppy_disk: '💾', cd: '💿', dvd: '📀', minidisc: '💽', vhs: '📼',
  camera: '📷', video_camera: '📹', movie_camera: '🎥', film_strip: '🎞️', tv: '📺',
  iphone: '📱', telephone: '☎️', satellite: '📡', battery: '🔋', electric_plug: '🔌',
  mag: '🔍', mag_right: '🔎', microscope: '🔬', telescope: '🔭', link: '🔗', chains: '⛓️',
  lock: '🔒', unlock: '🔓', closed_lock_with_key: '🔐', key: '🔑', old_key: '🗝️',
  hammer: '🔨', wrench: '🔧', nut_and_bolt: '🔩', gear: '⚙️', toolbox: '🧰',
  hammer_and_wrench: '🛠️', screwdriver: '🪛', magnet: '🧲', test_tube: '🧪', petri_dish: '🧫',
  dna: '🧬', pill: '💊', syringe: '💉', bandaid: '🩹', stethoscope: '🩺',
  broom: '🧹', soap: '🧼', sponge: '🧽', bucket: '🪣', wastebasket: '🗑️',
  hourglass_done: '⏳', construction: '🚧', building_construction: '🏗️',
  bug: '🐛', ant: '🐜', spider: '🕷️', spider_web: '🕸️', snake: '🐍', turtle: '🐢',
  penguin: '🐧', whale: '🐳', dolphin: '🐬', octopus: '🐙', unicorn: '🦄', dragon: '🐉',
  cat: '🐱', dog: '🐶', fox_face: '🦊', bear: '🐻', panda_face: '🐼', koala: '🐨',
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', champagne: '🍾', clinking_glasses: '🥂',
  pizza: '🍕', hamburger: '🍔', fries: '🍟', taco: '🌮', doughnut: '🍩', cookie: '🍪',
  cake: '🍰', birthday: '🎂', candy: '🍬', lollipop: '🍭', apple: '🍎', banana: '🍌',
  hot_pepper: '🌶️', herb: '🌿', seedling: '🌱', deciduous_tree: '🌳', cactus: '🌵',
  four_leaf_clover: '🍀', maple_leaf: '🍁', mushroom: '🍄', sunflower: '🌻', tulip: '🌷',

  // ── Travel, places, misc ──
  house: '🏠', office: '🏢', factory: '🏭', hospital: '🏥', school: '🏫', bank: '🏦',
  car: '🚗', bus: '🚌', train: '🚆', airplane: '✈️', ship: '🚢', anchor: '⚓',
  bike: '🚲', scooter: '🛴', traffic_light: '🚦', world_map: '🗺️', compass: '🧭',
  art: '🎨', musical_note: '🎵', notes: '🎶', headphones: '🎧', microphone: '🎤',
  guitar: '🎸', game_die: '🎲', dart: '🎯', video_game: '🎮', joystick: '🕹️',
  jigsaw: '🧩', teddy_bear: '🧸', magic_wand: '🪄', crystal_ball: '🔮', ring: '💍',

  // ── The ones with no other home ──
  shipit: '🚢', ship_it: '🚢', eyeglasses: '👓', shipping: '📦',
  speech_balloon: '💬', thought_balloon: '💭', zzz: '💤', hash: '#️⃣', asterisk: '*️⃣',
  copyright: '©️', registered: '®️', tm: '™️', infinity: '♾️', wavy_dash: '〰️',
  100: '💯', 'ok': '🆗', new: '🆕', free: '🆓', up: '🆙', cool: '🆒', sos: '🆘',
};

/**
 * The shortcode pattern, and the whole safety argument.
 *
 * Only KNOWN names are replaced, so `10:30:45` cannot become anything, `3:4` cannot, and a
 * French sentence ending in a colon cannot. An unknown shortcode stays exactly as typed rather
 * than disappearing — the reader sees what the author wrote and can go and fix it.
 *
 * The preceding character must not be a word character, so `path:rocket:x` is left alone: a
 * colon inside an identifier is not a shortcode.
 */
const SHORTCODE = /(^|[^\w:])(:([a-z0-9_+-]{1,32}):)/gi;

/** Replace the shortcodes in one string. Returns the same string when there are none. */
export function replaceEmoji(text: string): string {
    if (typeof text !== 'string' || !text.includes(':')) return text;
    return text.replace(SHORTCODE, (whole, before, _code, name) => {
        const hit = EMOJI[String(name).toLowerCase()];
        return hit ? before + hit : whole;
    });
}
