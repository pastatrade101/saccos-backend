const NEXT_OF_KIN_RELATIONSHIPS = [
    "spouse",
    "father",
    "mother",
    "son",
    "daughter",
    "brother",
    "sister",
    "guardian",
    "relative",
    "friend",
    "other"
];

const LEGACY_NEXT_OF_KIN_RELATIONSHIPS = [
    "parent",
    "sibling",
    "child"
];

const ALL_NEXT_OF_KIN_RELATIONSHIPS = [
    ...NEXT_OF_KIN_RELATIONSHIPS,
    ...LEGACY_NEXT_OF_KIN_RELATIONSHIPS
];

module.exports = {
    NEXT_OF_KIN_RELATIONSHIPS,
    LEGACY_NEXT_OF_KIN_RELATIONSHIPS,
    ALL_NEXT_OF_KIN_RELATIONSHIPS
};
