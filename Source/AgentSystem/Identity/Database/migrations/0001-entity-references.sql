CREATE TABLE entity_references (
  domain TEXT NOT NULL,
  reference TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY(domain, reference),
  UNIQUE(domain, entity_id)
) STRICT;

CREATE TABLE entity_reference_aliases (
  domain TEXT NOT NULL,
  alias TEXT NOT NULL,
  reference TEXT NOT NULL,
  PRIMARY KEY(domain, alias),
  FOREIGN KEY(domain, reference) REFERENCES entity_references(domain, reference)
) STRICT;
