# Kurdish plant names — reviewer worklist

Generated from `plants.json`, which is the single source of truth. This file is a
by-product — change the catalog and regenerate it, never edit this list directly.

Regenerate with:

```
node scripts/kurdish-review.js
```

## How to read the status column

- `verified` — the Kurdish name was checked against a registered reference source.
- `needs_native_review` — the name is in use and understandable, but no reference
  source could confirm it. It has NOT been verified, and it is not claimed to be.

## Summary

- plants in the catalog: **63**
- Kurdish names verified against a source: **36**
- awaiting a native Sorani reviewer: **27**

## What a reviewer needs to supply

For each row below, the useful answer is one line:

```
<plant id> | yes/no (is the current name acceptable) | the name you would use | the source you checked
```

If the current name is fine, "yes" is the whole answer. If it is wrong, the name you
give replaces it and the old one is kept as a search alias, so nothing is lost.

## Waiting for review

| plant id | scientific name | English | Arabic | current Kurdish | why flagged |
| --- | --- | --- | --- | --- | --- |
| pl-radish | Raphanus sativus | Radish | فجل | تورپ | Sorani Wikipedia gives توور for radish; تورپ kept as the local form. |
| pl-bell-pepper | Capsicum annuum Grossum Group | Bell Pepper | فلفل حلو | بیبەری شیرین | A phrase (sweet pepper), not a fixed name. No lexical source found. |
| pl-pumpkin | Cucurbita maxima | Pumpkin | قرع | کەدوو | No lexical source found; widely used as found. |
| pl-basil | Ocimum basilicum | Basil | ريحان | ڕەیحان | No lexical source found; widely used as found. |
| pl-mint | Mentha spicata | Mint | نعناع | نەعناع | No lexical source found; widely used as found. |
| pl-parsley | Petroselinum crispum | Parsley | بقدونس | مەعدەنۆس | Sorani Wikipedia titles parsley جاڤری; مەعدەنۆس kept as the everyday local word. |
| pl-coriander | Coriandrum sativum | Coriander | كزبرة | کەشنیز | No lexical source found; widely used as found. |
| pl-thyme | Thymus vulgaris | Thyme | زعتر | زەعتەر | No lexical source found; widely used as found. |
| pl-pothos | Epipremnum aureum | Pothos | بوتوس | پۆتۆس | Transliterated name; these houseplants have no established Sorani name. |
| pl-snake-plant | Dracaena trifasciata | Snake Plant | نبتة الأفعى | ڕووەکی مار | Descriptive phrase, not an established Sorani name. |
| pl-spider-plant | Chlorophytum comosum | Spider Plant | نبتة العنكبوت | ڕووەکی جاڵجاڵۆکە | Descriptive phrase, not an established Sorani name. |
| pl-aloe-vera | Aloe vera | Aloe Vera | ألوفيرا | ئەلۆی ڤێرا | Transliterated name; no lexical source checked. |
| pl-zz-plant | Zamioculcas zamiifolia | ZZ Plant | نبتة زد زد | ڕووەکی ZZ | Keeps the cultivar letters; no Sorani name exists. |
| pl-peace-lily | Spathiphyllum wallisii | Peace Lily | زنبق السلام | زەنباقی ئاشتی | Literal translation of the English name. |
| pl-monstera | Monstera deliciosa | Monstera | مونستيرا | مۆنستێرا | Transliterated name; no lexical source checked. |
| pl-eggplant | Solanum melongena | Eggplant | باذنجان | بێنجان | Sorani Wikipedia and the Sorani wordlist write باینجان; بێنجان kept as the local form. |
| pl-green-bean | Phaseolus vulgaris | Green Bean | فاصولياء | لۆبیا | Sorani wordlist gives فاسۆلیا; لۆبیا kept as the everyday local word. |
| pl-okra | Abelmoschus esculentus | Okra | بامية | بامیە | Sorani Wikipedia titles okra بامێ; بامیە kept as the local form. |
| pl-arugula | Eruca vesicaria | Arugula | جرجير | جرجیر | جرجیر is the Arabic name; no settled Sorani term found for rocket. Needs a native speaker. |
| pl-swiss-chard | Beta vulgaris var. cicla | Swiss Chard | سلق | سەلق | سەلق is borrowed from Iraqi Arabic; no Sorani term found. |
| pl-celery | Apium graveolens | Celery | كرفس | کەرەفس | No lexical source found; widely used as found. |
| pl-oregano | Origanum vulgare | Oregano | أوريجانو | ئۆریگانۆ | Sorani Wikipedia gives ئەزبۆڵە for oregano; ئۆریگانۆ is the transliteration in use. |
| pl-sage | Salvia officinalis | Sage | مريمية | مەریەمیە | No lexical source found; widely used as found. |
| pl-lavender | Lavandula angustifolia | Lavender | خزامى | لاڤەندەر | Transliterated name; no lexical source checked. |
| pl-lemon-balm | Melissa officinalis | Lemon Balm | مليسة | مێلیسا | Transliterated name; no lexical source checked. |
| pl-jade-plant | Crassula ovata | Jade Plant | نبتة اليشم | ڕووەکی یەشیم | Descriptive phrase, not an established Sorani name. |
| pl-rubber-plant | Ficus elastica | Rubber Plant | فيكس مطاطي | ڕووەکی لاستیک | Descriptive phrase, not an established Sorani name. |

## Sources registered in the catalog

- `powo` — Plants of the World Online (Royal Botanic Gardens, Kew)
- `ecocrop` — ECOCROP — crop environmental requirements (FAO)
- `fao-calendar` — FAO crop calendars (FAO)
- `greenomy` — Greenomy editorial summary (Greenomy)
- `ckb-wikipedia` — Kurdish (Sorani) Wikipedia (Wikimedia)
- `vejinlex` — VejinLex / Kurdistanica - English to Central Kurdish dictionary (Eli Cewsheni)
- `sorani-wordlist` — Central Kurdish (Sorani) wordlist - vegetable names (mkanabi/Kurdish-wordlist)
