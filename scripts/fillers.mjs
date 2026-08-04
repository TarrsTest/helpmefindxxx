// Background population for calibration measurement.
//
// WHY THIS FILE IS HAND-WRITTEN PROSE AND NOT A TEMPLATE
//
// The obvious way to produce 120 filler profiles is a template with slots:
// "I am a {job}. I want to meet {person}." That would be worthless here, and
// worse than worthless because it would look like it worked. Every generated
// text would share the same scaffolding, so every embedding would share a
// large common component, and the population would sit in a tight ball in
// vector space. The random-stranger baseline would come out with an
// artificially small spread, and a spread that is too small makes the sample
// mean converge faster than it ever would on real people — the measurement
// would then report that MATCH_BASELINE_SAMPLE is plenty when the only thing
// it measured was the template.
//
// So the variation here is deliberate and on three axes at once:
//   - VOCABULARY: 60 unrelated fields, each with its own concrete nouns and
//     verbs. This is what actually moves an embedding.
//   - STRUCTURE: openings, clause order and sentence count vary. No two
//     entries share a frame.
//   - LENGTH: from a terse eight words to a winding thirty.
//
// TWO EXCLUSIONS THAT ARE LOAD-BEARING — do not add a domain that violates
// them, or the ground truth in seed-demo.mjs quietly stops being ground truth:
//
//   1. NOTHING medical/cardiac-surgical, and nothing involving saturation
//      diving, underwater welding or offshore platforms. `needs_surgeon` and
//      `needs_welder` are the two probands defined as having NOBODY here who
//      fits. Give either of them a plausible counterpart and the noise
//      reference — the thing every signal threshold is measured against —
//      silently becomes a match case.
//   2. NOTHING in the ten paired domains: ML research, venture capital, game
//      art, gameplay programming, spare rooms/relocation, Spanish/Mandarin
//      exchange, baking, grain milling. A filler in one of those becomes a
//      competing candidate and shifts the very separation figures the pool
//      exists to measure.
//
// The six original fillers (bird ringing, tax law, ceramics, ultrarunning,
// sailmaking, municipal archives) are also avoided, so the pool gains breadth
// rather than depth.

/** 60 unrelated fields, two differently-shaped people in each. */
export const FILLERS = [
  { h: 'beekeep_a', self: 'I keep forty hives on chalk downland and breed queens for temper rather than yield.', seeking: 'Orchard owners who want hives placed on their land during blossom.' },
  { h: 'beekeep_b', self: 'Beekeeping started as a hobby; I now extract, filter and jar about two tonnes a season.', seeking: 'A mentor who has run a commercial apiary through a bad varroa year.' },

  { h: 'lighthouse_a', self: 'My work is the restoration of decommissioned lighthouses — lantern glazing, brass, and the original clockwork.', seeking: 'Heritage trusts with a tower they cannot afford to demolish.' },
  { h: 'lighthouse_b', self: 'I document lighthouse optics before they are scrapped.', seeking: 'Photographers willing to shoot interiors in very poor light.' },

  { h: 'typeface_a', self: 'I draw text faces for long-form reading, mostly serif, mostly for print.', seeking: 'Publishers commissioning a bespoke face for a series.' },
  { h: 'typeface_b', self: 'After fifteen years in lettering I now design multi-script type, currently extending a family into Cyrillic and Greek.', seeking: 'A native reader who can judge whether my Greek italics feel wrong.' },

  { h: 'cave_a', self: 'I survey unmapped cave systems and turn tape-and-compass data into publishable plans.', seeking: 'Cavers who know an unsurveyed passage and want it on paper.' },
  { h: 'cave_b', self: 'Weekends underground, weekdays drawing what I found.', seeking: 'Someone who can teach me photogrammetry in confined spaces.' },

  { h: 'bookbind_a', self: 'I bind books by hand in full leather with gold tooling, one at a time.', seeking: 'Collectors who need a fine binding for a manuscript.' },
  { h: 'bookbind_b', self: 'My bench does conservation rebinding for libraries: resewing, board reattachment, no unnecessary intervention.', seeking: 'An apprentice prepared to spend two years on paring alone.' },

  { h: 'myco_a', self: 'I identify fungi from spore prints and microscopy, and lead foraging walks in beech woods.', seeking: 'Restaurants that want a reliable seasonal supply of wild mushrooms.' },
  { h: 'myco_b', self: 'Mycology is my second career; I am cataloguing the fungal species of one valley over ten years.', seeking: 'A taxonomist who can check my determinations of difficult Cortinarius.' },

  { h: 'luthier_a', self: 'I make violins on a Guarneri pattern and varnish them with my own spirit recipe.', seeking: 'Soloists who want an instrument made to their hand.' },
  { h: 'luthier_b', self: 'Repair work, mostly — cracked bellies, sunken necks, bad old restorations to undo.', seeking: 'Orchestras that need a technician on call during a touring season.' },

  { h: 'astro_a', self: 'I hunt near-Earth asteroids from a backyard observatory and submit astrometry most clear nights.', seeking: 'Observers in other longitudes to cover the hours I cannot.' },
  { h: 'astro_b', self: 'My telescope is small and my patience is long; I measure variable star light curves.', seeking: 'A statistician interested in period analysis of sparse data.' },

  { h: 'brew_a', self: 'I brew unfiltered lager and lager only, decoction mashed, lagered for ten weeks.', seeking: 'Bars willing to keep a slow beer on tap.' },
  { h: 'brew_b', self: 'Running a five-barrel brewery taught me that yeast management is the whole job.', seeking: 'A supplier of open-pollinated hops grown without irrigation.' },

  { h: 'glass_a', self: 'I bend neon tubing for signs and sculpture, by torch, the way it has always been done.', seeking: 'Architects who want light that is drawn rather than fitted.' },
  { h: 'glass_b', self: 'Glassblowing, hot shop, mostly vessels.', seeking: 'A studio to share so the furnace runs more than half the week.' },

  { h: 'subtitle_a', self: 'I subtitle feature films from Portuguese and Italian, and I argue about line breaks for a living.', seeking: 'Festival programmers who need accurate subtitles on a short deadline.' },
  { h: 'subtitle_b', self: 'Twenty years of audiovisual translation; lately I train others in it.', seeking: 'Translators moving into subtitling who want their first files reviewed.' },

  { h: 'falconry_a', self: 'I fly harris hawks and train them for airfield bird control.', seeking: 'Airfields or landfills with a gull problem and no chemical option.' },
  { h: 'falconry_b', self: 'My birds are goshawks, my seasons are short, and my gloves are always wet.', seeking: 'A falconer nearby to hawk with through the winter.' },

  { h: 'drystone_a', self: 'I build dry stone walls without mortar, matching the local style stone by stone.', seeking: 'Farms with collapsed field boundaries that must be rebuilt to standard.' },
  { h: 'drystone_b', self: 'Waller by trade. I also teach weekend courses.', seeking: 'Landowners willing to host a training wall on their boundary.' },

  { h: 'tattoo_a', self: 'I tattoo fine-line botanical work and refuse anything I have drawn before.', seeking: 'Clients who will bring an idea rather than a screenshot.' },
  { h: 'tattoo_b', self: 'My studio does cover-ups and scar camouflage, which is mostly a problem of colour theory.', seeking: 'A dermatologist willing to advise on healing in scarred skin.' },

  { h: 'drone_a', self: 'I fly camera drones for documentary work, usually somewhere cold.', seeking: 'Directors who need aerial coverage in places a helicopter cannot reach.' },
  { h: 'drone_b', self: 'Certified for beyond-visual-line-of-sight; I map quarries and stockpiles by volume.', seeking: 'Quarry managers who still measure stock by eye.' },

  { h: 'seedbank_a', self: 'I keep and multiply heirloom vegetable varieties, roughly four hundred lines, all open-pollinated.', seeking: 'Growers to trial old varieties in climates I cannot test.' },
  { h: 'seedbank_b', self: 'Seed saving, isolation distances, and a lot of paper envelopes.', seeking: 'A community garden that will host an isolation plot.' },

  { h: 'horology_a', self: 'I restore mechanical clocks — fusee movements, mostly, and the occasional turret clock.', seeking: 'Churches with a tower clock nobody has wound since the sixties.' },
  { h: 'horology_b', self: 'Watchmaking school, then ten years at a bench servicing chronographs.', seeking: 'Collectors who would rather have a watch serviced than replaced.' },

  { h: 'river_a', self: 'I design river restoration: removing weirs, remeandering straightened channels, putting gravel back.', seeking: 'Catchment partnerships with a barrier they want gone.' },
  { h: 'river_b', self: 'Freshwater ecology, chiefly invertebrate response to habitat works.', seeking: 'A hydrologist to model flows before we commit to a design.' },

  { h: 'puppet_a', self: 'I make and perform rod puppets for adult audiences, often about difficult subjects.', seeking: 'Venues willing to programme puppetry that is not for children.' },
  { h: 'puppet_b', self: 'Carving, mechanisms, eyes that blink. The performing is somebody else’s job.', seeking: 'A company that needs a fabricator for a touring show.' },

  { h: 'chess_a', self: 'I coach juniors through the awkward stage where talent stops being enough.', seeking: 'Schools that want a serious chess programme rather than a lunchtime club.' },
  { h: 'chess_b', self: 'Correspondence player, opening theory obsessive, moderate over-the-board strength.', seeking: 'An analysis partner for closed positions.' },

  { h: 'perfume_a', self: 'I compose fragrance from naturals, working mostly in leather and smoke accords.', seeking: 'Small houses looking for a perfumer who does not follow briefs.' },
  { h: 'perfume_b', self: 'My background is analytical chemistry; I moved into scent because the problem is harder.', seeking: 'A distiller with access to unusual raw material.' },

  { h: 'carto_a', self: 'I draw maps by hand for books — relief shading, place names, no satellite basemaps.', seeking: 'Authors whose book needs a map that matches its prose.' },
  { h: 'carto_b', self: 'Cartographer, formerly at a national mapping agency, now independent.', seeking: 'Historians needing period-accurate reconstructions of vanished streets.' },

  { h: 'soil_a', self: 'I study soil microbial communities under different tillage regimes.', seeking: 'Farms prepared to leave a strip untilled for six years.' },
  { h: 'soil_b', self: 'Most of my day is DNA extraction from dirt, which is less glamorous than it sounds.', seeking: 'A bioinformatician who enjoys messy amplicon data.' },

  { h: 'audiobook_a', self: 'I narrate long-form nonfiction and can hold a consistent read across forty hours.', seeking: 'Publishers with dense books nobody else wants to record.' },
  { h: 'audiobook_b', self: 'Voice work, home booth, and a very quiet street.', seeking: 'An engineer to master my raw files to broadcast spec.' },

  { h: 'sharpen_a', self: 'I sharpen kitchen and woodworking edges on waterstones, and I regrind bevels that were set wrong at the factory.', seeking: 'Restaurant kitchens that currently throw knives away.' },
  { h: 'sharpen_b', self: 'Edge geometry is the whole thing; steel is secondary.', seeking: 'A metallurgist who can explain why one batch holds an edge and the next does not.' },

  { h: 'stainedglass_a', self: 'I conserve medieval stained glass — releading, edge-bonding, and as little cleaning as I can get away with.', seeking: 'Cathedral fabric committees planning a window campaign.' },
  { h: 'stainedglass_b', self: 'New commissions in leaded glass, abstract, mostly for private houses.', seeking: 'An architect who will design an opening around the glass instead of after it.' },

  { h: 'routeset_a', self: 'I set climbing routes for competitions and try to make the hard move the interesting one.', seeking: 'Gyms that want their walls reset by someone who climbs at their grade.' },
  { h: 'routeset_b', self: 'Bolting new sport routes on limestone, slowly, with permission.', seeking: 'Access negotiators who can talk to landowners.' },

  { h: 'embroid_a', self: 'I conserve historic textiles: couching down failing embroidery, stabilising silk that has gone to powder.', seeking: 'Museums with a costume collection they cannot display.' },
  { h: 'embroid_b', self: 'Goldwork, by hand, for ceremonial dress.', seeking: 'A regiment or guild needing insignia reproduced accurately.' },

  { h: 'balloon_a', self: 'I launch radiosondes and analyse boundary-layer profiles.', seeking: 'A pilot willing to carry instruments on regular light-aircraft flights.' },
  { h: 'balloon_b', self: 'My interest is fog: when it forms, why the models get it wrong, and how to measure it cheaply.', seeking: 'Airports with fog problems and a tolerance for experiments.' },

  { h: 'barber_a', self: 'I cut hair with scissors over comb and have not owned clippers in years.', seeking: 'A chair to rent in a shop that closes on Mondays.' },
  { h: 'barber_b', self: 'Twenty-two years behind a chair; I now teach classical cutting.', seeking: 'Barbers in their first year who want structure rather than trends.' },

  { h: 'cheese_a', self: 'I age cheese in a stone cellar — turning, brushing, and deciding when a wheel is ready.', seeking: 'Dairies making raw-milk cheese that needs affinage.' },
  { h: 'cheese_b', self: 'Affineur, formerly a chef, currently arguing with a humidity controller.', seeking: 'Cheesemongers who will sell at proper ripeness rather than shelf life.' },

  { h: 'railway_a', self: 'I build finescale model railways to prototype dimensions, which means most commercial track is unusable.', seeking: 'Machinists who can cut small brass parts to tolerance.' },
  { h: 'railway_b', self: 'Signalling is my corner of it — real interlocking logic, in miniature.', seeking: 'A retired signaller who remembers how a box actually worked.' },

  { h: 'signlang_a', self: 'I interpret between spoken English and sign language in legal settings.', seeking: 'Courts that book interpreters early enough to prepare.' },
  { h: 'signlang_b', self: 'Deaf theatre is where I do my best work; the register is completely different from courtroom work.', seeking: 'Directors staging a bilingual production.' },

  { h: 'cycling_a', self: 'I plan cycling infrastructure and spend most of my time on junction geometry.', seeking: 'Councils that will fund a scheme past the consultation stage.' },
  { h: 'cycling_b', self: 'Transport planner. I count people, not vehicles.', seeking: 'A data scientist to help me model severance effects.' },

  { h: 'fossil_a', self: 'I prepare fossils out of matrix with an air scribe, sometimes for months on one specimen.', seeking: 'Museums with unprepared material in storage.' },
  { h: 'fossil_b', self: 'Marine reptiles, chiefly; the work is half preparation and half deciding what not to remove.', seeking: 'A researcher who needs a specimen prepared before publication.' },

  { h: 'sound_a', self: 'I mix live sound for acoustic music and try to make the PA disappear.', seeking: 'Venues with a room problem they think is an equipment problem.' },
  { h: 'sound_b', self: 'Front of house, monitors, and increasingly system tuning for touring rigs.', seeking: 'An acoustician who will look at three difficult halls with me.' },

  { h: 'botill_a', self: 'I illustrate plants for scientific description — dissections, scale bars, no artistic licence.', seeking: 'Botanists describing new species who need publication-quality plates.' },
  { h: 'botill_b', self: 'Watercolour, from living material, usually before it wilts.', seeking: 'A herbarium that will let me work from fresh collections.' },

  { h: 'wildfire_a', self: 'I plan fuel reduction burns and write the prescriptions that say when we can light one.', seeking: 'Landowners who accept that fire is coming either way.' },
  { h: 'wildfire_b', self: 'Fire behaviour modelling, mostly, with too little data on fuel moisture.', seeking: 'Anyone collecting long-run fuel moisture records.' },

  { h: 'furniture_a', self: 'I restore antique furniture using hide glue and shellac, so the next restorer can undo my work.', seeking: 'Auction houses needing sympathetic repair before a sale.' },
  { h: 'furniture_b', self: 'Cabinetmaking by hand; veneer and marquetry when I can get the work.', seeking: 'A timber merchant with properly dried native hardwood.' },

  { h: 'rowing_a', self: 'I coach rowing crews and spend the winter fixing what the summer hid.', seeking: 'Clubs with strong athletes and no technical coaching.' },
  { h: 'rowing_b', self: 'Sculling technique, video analysis, and a launch that barely starts.', seeking: 'A biomechanist interested in the catch.' },

  { h: 'litho_a', self: 'I work on semiconductor lithography — overlay error, mostly, and why it drifts.', seeking: 'Fabs willing to share process data under an agreement.' },
  { h: 'litho_b', self: 'Optical metrology by training, now debugging tools that cost more than buildings.', seeking: 'An engineer who has seen the same drift on a different platform.' },

  { h: 'patent_a', self: 'I examine patent applications in mechanical engineering and read a great deal of bad prose.', seeking: 'Attorneys who want to understand why claims get objected to.' },
  { h: 'patent_b', self: 'Formerly an examiner, now advising inventors before they file.', seeking: 'Small manufacturers about to disclose something they should not.' },

  { h: 'lichen_a', self: 'I identify lichens, which means chemistry as much as morphology.', seeking: 'Surveyors who need air quality inferred from what is growing on the bark.' },
  { h: 'lichen_b', self: 'Taxonomy of crustose species — the unglamorous ones nobody wants.', seeking: 'A herbarium willing to loan type material.' },

  { h: 'ballet_a', self: 'I stage classical ballets from notation and rehearse companies through them.', seeking: 'Companies reviving a work nobody currently dancing has performed.' },
  { h: 'ballet_b', self: 'Répétiteur; my job is the difference between the steps and the dancing.', seeking: 'A notator to record a production before the cast disperses.' },

  { h: 'salt_a', self: 'I make sea salt in shallow pans and rake it by hand, weather permitting.', seeking: 'Chefs who can tell one salt from another.' },
  { h: 'salt_b', self: 'Salt production, coastal, entirely dependent on how much it rains.', seeking: 'A coastal engineer to advise on rebuilding the pans.' },

  { h: 'windrep_a', self: 'I repair woodwind instruments — pads, keywork, and cracks that owners ignored too long.', seeking: 'Conservatoires needing a repairer who can turn work around in a day.' },
  { h: 'windrep_b', self: 'Bassoons, chiefly, because nobody else wants them.', seeking: 'A bassoonist who will tell me honestly how a repair plays.' },

  { h: 'geneal_a', self: 'I research family history in parish records and estate papers, and I read secretary hand.', seeking: 'Families stuck at an ancestor who appears from nowhere in 1790.' },
  { h: 'geneal_b', self: 'Professional genealogist. Most of my cases are disputed estates.', seeking: 'Probate solicitors who need heirs traced properly.' },

  { h: 'skatepark_a', self: 'I design skateparks in concrete and shape transitions by eye before they are shot.', seeking: 'Councils that will consult skaters before commissioning a park.' },
  { h: 'skatepark_b', self: 'Twenty years skating, ten building. The two are not the same skill.', seeking: 'A concrete finisher who understands curved formwork.' },

  { h: 'cropins_a', self: 'I price crop insurance and argue with actuaries about tail risk in drought years.', seeking: 'Agronomists who can tell me what a yield model is missing.' },
  { h: 'cropins_b', self: 'Actuarial work on weather-indexed products for smallholders.', seeking: 'Cooperatives willing to pilot an index product for one season.' },

  { h: 'stopmo_a', self: 'I animate stop-motion puppets, twenty-four decisions per second of screen time.', seeking: 'Producers with the patience for a technique that takes months.' },
  { h: 'stopmo_b', self: 'Armature building and replacement faces; I rarely animate any more.', seeking: 'A machinist to make ball-and-socket joints in small batches.' },

  { h: 'tea_a', self: 'I source tea directly from small gardens and taste more of it than is good for me.', seeking: 'Growers producing small lots who cannot reach buyers.' },
  { h: 'tea_b', self: 'Tea buying, mostly oolong, and a long argument about oxidation.', seeking: 'Cafés willing to brew leaf tea properly rather than quickly.' },

  { h: 'agrobot_a', self: 'I build agricultural robots that weed row crops without chemicals.', seeking: 'Vegetable growers who will let a prototype loose on a real field.' },
  { h: 'agrobot_b', self: 'Machine vision for crop and weed discrimination — the hard part is mud.', seeking: 'A grower with an unusually weedy field and a sense of humour.' },

  { h: 'steno_a', self: 'I write courtroom transcripts on a stenotype at speeds that surprise people.', seeking: 'Courts that still want a human record rather than a recording.' },
  { h: 'steno_b', self: 'Realtime captioning for conferences, which is stenography with no second chances.', seeking: 'Conference organisers who budget for access from the start.' },

  { h: 'glacier_a', self: 'I measure glacier mass balance with stakes, which means walking a lot of ice.', seeking: 'Field assistants who can cope with six weeks and no shower.' },
  { h: 'glacier_b', self: 'Remote sensing of ice loss, ground-truthed badly, which is my complaint.', seeking: 'A field glaciologist whose measurements I can calibrate against.' },

  { h: 'organ_a', self: 'I tune and voice pipe organs and spend my working life inside cold buildings.', seeking: 'Churches with an instrument that has not been touched in a decade.' },
  { h: 'organ_b', self: 'Organ building, chiefly mechanical action; voicing is the part I care about.', seeking: 'An organist who will play an instrument honestly during regulation.' },

  { h: 'vertfarm_a', self: 'I run a vertical farm and have concluded that lighting cost decides everything.', seeking: 'Buyers who want leafy crops year-round at a stable price.' },
  { h: 'vertfarm_b', self: 'Controlled environment horticulture; my background is greenhouse engineering.', seeking: 'An energy consultant who can model heat recovery properly.' },

  { h: 'comic_a', self: 'I letter comics by hand and think balloon placement is half the storytelling.', seeking: 'Artists who leave room for the words.' },
  { h: 'comic_b', self: 'Lettering and production for translated editions, which is mostly refitting text.', seeking: 'Publishers bringing foreign-language comics into English.' },

  { h: 'sleddog_a', self: 'I train sled dogs, which is mostly feeding, feet, and knowing when to stop.', seeking: 'A handler for the racing season who does not mind the cold.' },
  { h: 'sleddog_b', self: 'Kennel of thirty; distance racing rather than sprint.', seeking: 'A veterinarian with working-dog experience.' },

  { h: 'waterqual_a', self: 'I test river water for pollution and chase discharges upstream until I find the pipe.', seeking: 'Angling clubs and residents who suspect a discharge but cannot prove it.' },
  { h: 'waterqual_b', self: 'Analytical chemistry, environmental samples, and a long backlog.', seeking: 'A laboratory to share instrument time with.' },

  { h: 'motorcycle_a', self: 'I restore vintage motorcycles and rebuild magnetos nobody else will touch.', seeking: 'Owners with a machine that has not run since the seventies.' },
  { h: 'motorcycle_b', self: 'Frame straightening and wheel building for pre-war bikes.', seeking: 'A supplier of correct-gauge spokes in small quantities.' },
];

/** Sanity: handles must be unique, or the seeder will collide on insert. */
const seen = new Set();
for (const f of FILLERS) {
  if (seen.has(f.h)) throw new Error(`duplicate filler handle: ${f.h}`);
  seen.add(f.h);
}
