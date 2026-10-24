import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileAutomaticProductAssignment,
  resetLineAfterProductChange,
  resetLineAfterSupplierChange,
  switchQuotationReviewLine,
} from "./supplier-quotation-review-state";

const reviewedDraft = {
  productId: "sweetened-creamer",
  productSelectionSource: "manual" as const,
  selected: true,
  unitConversionConfirmed: true,
  unitConversionNote: "1 tin equals 1 can, checked against both labels.",
  expanded: true,
};

test("changing a product clears selection and prior unit-conversion evidence", () => {
  assert.deepEqual(resetLineAfterProductChange(reviewedDraft, "instant-noodles-5-pack"), {
    ...reviewedDraft,
    productId: "instant-noodles-5-pack",
    productSelectionSource: "manual",
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
  });
});

test("a line opened before the catalogue loads receives its safe automatic match later", () => {
  const beforeCatalogue = {
    productId: "",
    productSelectionSource: "none" as const,
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
    expanded: true,
  };
  const afterCatalogue = reconcileAutomaticProductAssignment(beforeCatalogue, "premium-fragrant-rice");

  assert.equal(afterCatalogue.productId, "premium-fragrant-rice");
  assert.equal(afterCatalogue.productSelectionSource, "auto");
  assert.equal(afterCatalogue.expanded, true);
  assert.equal(afterCatalogue.selected, false, "catalogue loading must not confirm the price");
});

test("catalogue refresh does not overwrite a manual product correction", () => {
  const manualDraft = { ...reviewedDraft, productSelectionSource: "manual" as const };
  assert.equal(reconcileAutomaticProductAssignment(manualDraft, "premium-fragrant-rice"), manualDraft);
});

test("switching review lines clears selection and keeps each line's product draft isolated", () => {
  const firstLine = { ...reviewedDraft, expanded: true };
  const secondLine = {
    ...reviewedDraft,
    productId: "",
    productSelectionSource: "none" as const,
    expanded: false,
  };
  const switched = switchQuotationReviewLine(
    { first: firstLine, second: secondLine },
    ["first", "second"],
    "second",
    () => ({ ...secondLine }),
  );

  assert.equal(switched.first.productId, "sweetened-creamer");
  assert.equal(switched.first.expanded, false);
  assert.equal(switched.first.selected, false);
  assert.equal(switched.second.productId, "");
  assert.equal(switched.second.expanded, true);
  assert.equal(switched.second.selected, false);
});

test("changing the document supplier clears pending line selection and conversion evidence", () => {
  assert.deepEqual(resetLineAfterSupplierChange(reviewedDraft), {
    ...reviewedDraft,
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
  });
});
