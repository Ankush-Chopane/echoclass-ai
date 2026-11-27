# Training the classroom pose classifier

The live app currently recognizes 12 application-defined, **static, one-hand classroom cues** plus a `NONE` class. These cues are not validated ISL signs. The checked-in model has not been evaluated on real signers; training on synthetic skeletons must not be reported as sign-language accuracy.

## Collect real samples

Have an ISL instructor and Deaf signers validate the intended sign, label, and classroom meaning before adding any ISL cue. Obtain informed consent (and guardian consent for minors). Store pseudonymous signer IDs, not names. Prefer recording landmarks only; do not retain video unless consent specifically covers it.

Create a UTF-8 JSONL file with one labeled sample per line. This abbreviated example shows the shape; each real row must contain all 21 landmark objects:

```json
{"label":"POINT","person":"p01","session":"s1","landmarks":[{"x":0.5,"y":0.6,"z":0}, "... exactly 21 landmarks ..."]}
```

`label` must be one of the registered gesture IDs in `shared/gestures.js` or `NONE`. Train a selected vocabulary subset by including only those registered IDs, but always include `NONE` examples such as resting hands and ordinary pointing. Collect each class from multiple signers, under varied lighting, camera angles, and hand positions. Do not split frames from the same signer across training and validation.

## Train

```bash
npm run train:gestures -- --data path/to/consented-samples.jsonl --epochs 60
```

Training requires real labeled samples from at least two people, validates the landmark shape and labels, and creates a deterministic, approximately 80/20 person-disjoint split. Every selected class must occur in both splits. Synthetic data is not generated or mixed in. The script warns when fewer than five people are represented and writes the model to `shared/gesture-model.json` and `shared/gesture-model.js`.

The reported validation accuracy applies only to the held-out signers and collected conditions. It is not a general ISL accuracy claim. Keep the original model and dataset backed up before training; the output files are overwritten.

## Important scope limit

This trainer accepts only the current one-hand static pose features and registered cue labels. It does not recognize two-hand or moving signs, facial grammar, or continuous ISL sentences. Supporting those requires an expert-validated vocabulary, a consented sequence dataset, and a sequence model—not just retraining this classifier.
