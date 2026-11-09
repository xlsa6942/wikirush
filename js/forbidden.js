// Règle "pages interdites" : les pays et les années servent de raccourcis
// vers presque tout, donc on les bloque quand la règle est activée.

const COUNTRIES = [
  'Afghanistan', 'Afrique du Sud', 'Albanie', 'Algérie', 'Allemagne', 'Andorre', 'Angola',
  'Antigua-et-Barbuda', 'Arabie saoudite', 'Argentine', 'Arménie', 'Australie', 'Autriche',
  'Azerbaïdjan', 'Bahamas', 'Bahreïn', 'Bangladesh', 'Barbade', 'Belgique', 'Belize', 'Bénin',
  'Bhoutan', 'Biélorussie', 'Birmanie', 'Bolivie', 'Bosnie-Herzégovine', 'Botswana', 'Brésil',
  'Brunei', 'Bulgarie', 'Burkina Faso', 'Burundi', 'Cambodge', 'Cameroun', 'Canada', 'Cap-Vert',
  'Chili', 'Chine', 'République populaire de Chine', 'Chypre (pays)', 'Chypre', 'Colombie', 'Comores (pays)', 'Comores',
  'Corée du Nord', 'Corée du Sud', 'Corée', 'Costa Rica', "Côte d'Ivoire", 'Croatie', 'Cuba', 'Danemark',
  'Djibouti', 'Dominique (pays)', 'Égypte', 'Émirats arabes unis', 'Équateur (pays)', 'Érythrée',
  'Espagne', 'Estonie', 'Eswatini', 'États-Unis', 'Éthiopie', 'Fidji', 'Finlande', 'France',
  'Gabon', 'Gambie', 'Géorgie (pays)', 'Ghana', 'Grèce', 'Grenade (pays)', 'Guatemala', 'Guinée',
  'Guinée-Bissau', 'Guinée équatoriale', 'Guyana', 'Haïti', 'Honduras', 'Hongrie', 'Inde',
  'Indonésie', 'Irak', 'Iran', 'Irlande (pays)', 'Islande', 'Israël', 'Italie', 'Jamaïque', 'Japon',
  'Jordanie', 'Kazakhstan', 'Kenya', 'Kirghizistan', 'Kiribati', 'Kosovo', 'Koweït', 'Laos',
  'Lesotho', 'Lettonie', 'Liban', 'Liberia', 'Libye', 'Liechtenstein', 'Lituanie', 'Luxembourg (pays)',
  'Luxembourg', 'Macédoine du Nord', 'Madagascar', 'Malaisie', 'Malawi', 'Maldives', 'Mali', 'Malte',
  'Maroc', 'Îles Marshall', 'Maurice (pays)', 'Mauritanie', 'Mexique', 'États fédérés de Micronésie',
  'Moldavie', 'Monaco', 'Mongolie', 'Monténégro', 'Mozambique', 'Namibie', 'Nauru', 'Népal',
  'Nicaragua', 'Niger', 'Nigeria', 'Norvège', 'Nouvelle-Zélande', 'Oman', 'Ouganda', 'Ouzbékistan',
  'Pakistan', 'Palaos', 'Palestine', 'État de Palestine', 'Panama', 'Papouasie-Nouvelle-Guinée',
  'Paraguay', 'Pays-Bas', 'Pérou', 'Philippines', 'Pologne', 'Portugal', 'Qatar',
  'République centrafricaine', 'République démocratique du Congo', 'République du Congo',
  'République dominicaine', 'Tchéquie', 'République tchèque', 'Roumanie', 'Royaume-Uni', 'Russie', 'Rwanda',
  'Saint-Christophe-et-Niévès', 'Saint-Marin', 'Saint-Vincent-et-les-Grenadines', 'Sainte-Lucie',
  'Îles Salomon', 'Salvador', 'Samoa', 'Sao Tomé-et-Principe', 'Sénégal', 'Serbie', 'Seychelles',
  'Sierra Leone', 'Singapour', 'Slovaquie', 'Slovénie', 'Somalie', 'Soudan', 'Soudan du Sud',
  'Sri Lanka', 'Suède', 'Suisse', 'Suriname', 'Syrie', 'Tadjikistan', 'Taïwan', 'Tanzanie', 'Tchad',
  'Thaïlande', 'Timor oriental', 'Togo', 'Tonga', 'Trinité-et-Tobago', 'Tunisie', 'Turkménistan',
  'Turquie', 'Tuvalu', 'Ukraine', 'Uruguay', 'Vanuatu', 'Vatican', 'Venezuela', 'Viêt Nam', 'Vietnam',
  'Yémen', 'Zambie', 'Zimbabwe',
  // Nations constitutives et anciens États très "carrefour"
  'Angleterre', 'Écosse', 'Pays de Galles', 'Irlande du Nord', 'Union des républiques socialistes soviétiques',
  'Union soviétique', 'Allemagne de l\'Ouest', 'République démocratique allemande', 'Yougoslavie',
];

const COUNTRY_SET = new Set(COUNTRIES.map((c) => c.toLowerCase()));

const YEAR_PATTERNS = [
  /^-?\d{1,4}$/,                                  // 1998
  /^\d{1,4} av\. J\.-C\.$/,                       // 44 av. J.-C.
  /^années \d{1,4}( av\. J\.-C\.)?$/i,            // Années 1980
  /^[IVXLC]+e siècle( av\. J\.-C\.)?$/,           // XXe siècle
  /^[IVXLC]+er siècle( av\. J\.-C\.)?$/,          // Ier siècle
  /^[IVX]+e millénaire/,                          // IIe millénaire
  /^\d{1,4} (en|au|aux|dans) /,                   // 2019 en France, 1998 au cinéma
  /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{3,4}$/i,
];

export function isForbidden(title) {
  const t = String(title || '').replace(/_/g, ' ').trim();
  if (!t) return false;
  if (COUNTRY_SET.has(t.toLowerCase())) return true;
  return YEAR_PATTERNS.some((re) => re.test(t));
}
