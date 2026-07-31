-- 004_notes_seed.sql — one metadata row per unit; content lives in MDX files.
insert into public.notes (unit_id, slug, title, summary, status, sort_order)
select u.id, v.slug, v.title, v.summary, 'published'::note_status, v.sort_order
from (values
  ('fundamentals-of-forensic-science', 'Fundamentals of Forensic Science', 'Definitions, scope, history, and the Locard exchange principle that underlies every downstream discipline.', 1, 'Fundamentals of Forensic Science'),
  ('analytical-techniques', 'Analytical Techniques', 'Chromatography, spectroscopy, microscopy, and mass spectrometry — the instruments every forensic lab actually uses.', 2, 'Analytical Techniques'),
  ('forensic-biology-dna', 'Forensic Biology & DNA', 'Serology basics through STR profiling, PCR, mixture interpretation, and CODIS-style databases.', 3, 'Forensic Biology & DNA'),
  ('forensic-toxicology', 'Forensic Toxicology', 'Classification of poisons, absorption/distribution, common cases and analytical workflows.', 4, 'Forensic Toxicology'),
  ('forensic-ballistics', 'Forensic Ballistics', 'Internal, external, terminal ballistics; firearm identification, GSR analysis, comparison microscopy.', 5, 'Forensic Ballistics'),
  ('fire-explosives-investigation', 'Fire, Explosives & Investigation', 'Fire triangle, arson indicators, low- vs high-order explosives, post-blast residue analysis.', 6, 'Fire, Explosives & Investigation'),
  ('trace-evidence-digital-forensics', 'Trace Evidence & Digital Forensics', 'Hair, fibres, glass, paint; and modern digital-evidence acquisition and chain-of-custody.', 7, 'Trace Evidence & Digital Forensics'),
  ('fingerprints-biometric-systems', 'Fingerprints & Biometric Systems', 'Ridge patterns, three levels of detail, AFIS, and how modern biometrics extend the same principles.', 8, 'Fingerprints & Biometric Systems'),
  ('questioned-documents', 'Questioned Documents', 'Handwriting analysis, ink and paper examination, alteration detection, and the FDE workflow.', 9, 'Questioned Documents'),
  ('forensic-medicine-anthropology', 'Forensic Medicine & Anthropology', 'Cause vs manner of death, autopsy findings, skeletal remains identification, and estimating time since death.', 10, 'Forensic Medicine & Anthropology')
) as v(slug, title, summary, sort_order, unit_name)
join public.units u on u.name = v.unit_name
on conflict (slug) do update set title = excluded.title, summary = excluded.summary, sort_order = excluded.sort_order, unit_id = excluded.unit_id;
