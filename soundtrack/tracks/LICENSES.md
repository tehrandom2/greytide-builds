# Music: licence of the generated candidates

Every clip under `Assets/StreamingAssets/Music/<table>/*.ogg` (one folder per table, `default` for the shared list) was generated on littlebluebox from a text prompt with **ACE-Step 1.5**
(`acestep-v15-turbo` DiT, `acestep-5Hz-lm-1.7B` planner), run locally. Prompts, seeds and settings are in
`unity/tools/music/prompts.json` (written by `build_prompts.py`); per-track notes, with the seed, the measurements and the rejected seeds, are in `unity/tools/music/meta/`, and every candidate's measurements are in `unity/tools/music/measurements.json`.
Round two (#263, 2026-10-05) retired the dubstep tracks (prompts kept in the `archive` section of `prompts.json`) and added the laid-back, weird tracks for the ten tables, generated the same way. Round three (#372, 2026-10-05) added five build and five wave tracks each for the picnic and the garage, generated the same way.

## What was checked (2026-10-03)

- **Model and code licence: MIT.** `vendor/LICENSE` of the ACE-Step-1.5 checkout reads "MIT License, Copyright (c) 2026 ACEStep",
  its README says "licensed under MIT", and the downloaded checkpoint README says "License: MIT". (The shoosting project's
  README says Apache 2.0; the files on disk say MIT. Either permits commercial use of output; MIT is what is actually there.)
- **Commercial use of output:** the checkpoint README states the music may be used for commercial purposes, and describes the
  training data as licensed tracks, royalty-free/public-domain music and synthetic MIDI-to-audio data.
- **No third-party material went in:** text prompts only, no reference audio, no samples, no artist names in the prompts.

## What this does not settle

- Purely machine-generated audio with no human creative authorship is generally understood not to be copyrightable under current
  US Copyright Office guidance. We can use it freely; we probably cannot stop anyone else using the same files.
- The model authors disclaim responsibility for accidental stylistic similarity to existing works. Nobody has compared these
  tracks against anything, and nobody has listened to them yet (`needs:ears`).
- Disclosing AI-generated music in the game credits is what the model authors ask for; the owner should decide before shipping.
- Not a legal opinion.
