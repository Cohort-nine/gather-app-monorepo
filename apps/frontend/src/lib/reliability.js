const LABELS = {
  excellent: "Excellent",
  good: "Good",
  mixed: "Mixed",
  unreliable: "Unreliable",
  unrated: "Unrated"
};

export const reliabilityLabel = (band) => LABELS[band] ?? "Unrated";
