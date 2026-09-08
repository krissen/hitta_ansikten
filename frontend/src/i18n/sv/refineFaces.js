// Swedish catalog namespace: refineFaces
module.exports = {
  title: 'Förfina ansikten',
  sections: {
    filterMode: 'Filtreringsläge',
    settings: 'Inställningar',
  },
  modes: {
    std: {
      label: 'Standardavvikelse',
      desc: 'Ta bort kodningar som avviker mer än N standardavvikelser från medelvärdet',
    },
    cluster: {
      label: 'Kluster',
      desc: 'Behåll endast kodningar inom ett tätt kluster kring centroiden',
    },
    mahalanobis: {
      label: 'Mahalanobis',
      desc: 'Kovariansmedveten avvikelsedetektering (bättre för högdimensionella data)',
    },
    shape: {
      label: 'Formreparation',
      desc: 'Ta bort kodningar med inkonsekventa dimensioner',
    },
  },
  settings: {
    stdThreshold: 'Standardavvikelsetröskel:',
    stdHint: 'Högre = färre borttagna',
    clusterDist: 'Klusteravstånd:',
    clusterDistHint: 'Cosinusavstånd (0,35 = rekommenderat)',
    clusterMin: 'Minsta klusterstorlek:',
    mahalThreshold: 'Mahalanobis-tröskel:',
    mahalHint: 'Högre = färre borttagna (kräver många kodningar)',
    minEncodings: 'Minsta antal kodningar:',
    minEncodingsHint: 'Hoppa över personer med färre',
    person: 'Person:',
    personPlaceholder: 'Alla personer',
  },
  buttons: {
    simulateRepair: 'Simulera reparation',
    repairShapes: 'Reparera former',
    preview: 'Förhandsgranska',
    loading: 'Laddar…',
    applyFiltering: 'Tillämpa filtrering',
  },
  preview: {
    title: 'Förhandsgranskning',
    summaryPre: 'Totalt:',
    summaryEncodings: 'kodningar tas bort från',
    summaryOf: 'av {total} personer',
  },
  table: {
    person: 'Person',
    keep: 'Behåll',
    remove: 'Ta bort',
    statistics: 'Statistik',
    reason: 'Orsak',
  },
  reasons: {
    std_outlier: 'Standardavvikelse',
    cluster_outlier: 'Utanför kluster',
    mahalanobis_outlier: 'Mahalanobis',
    shape_mismatch: 'Fel form',
  },
  about: {
    title: 'Om filtrering',
    supportedPre: 'Endast kodningar från',
    supportedPost:
      'stöds (512-dimensionella, cosinusavstånd). dlib-motorn är föråldrad och bör tas bort.',
    stdText: 'tar bort kodningar långt från medelvärdet.',
    clusterText: 'behåller endast kodningar nära centroiden.',
    mahalanobisText: 'tar hänsyn till korrelationer mellan dimensioner.',
  },
  messages: {
    noEncodingsToRemove:
      'Inga kodningar att ta bort med nuvarande inställningar.',
    previewFailed: 'Kunde inte förhandsgranska: {error}',
    runPreviewFirst: 'Kör förhandsgranskning först',
    simulateConfirm: {
      one: 'Vill du simulera borttagning av {count} kodning från {people} personer?',
      other:
        'Vill du simulera borttagning av {count} kodningar från {people} personer?',
    },
    removeConfirm: {
      one: 'Vill du ta bort {count} kodning från {people} personer?',
      other: 'Vill du ta bort {count} kodningar från {people} personer?',
    },
    dryRunRemoved: {
      one: 'Simulering: {count} kodning skulle tas bort',
      other: 'Simulering: {count} kodningar skulle tas bort',
    },
    removed: {
      one: '{count} kodning borttagen',
      other: '{count} kodningar borttagna',
    },
    applyFailed: 'Kunde inte tillämpa filtreringen: {error}',
    noInconsistentShapes: 'Inga inkonsekventa former hittades.',
    repairDetail: '{person}: {removed} av {total} (behåller {shape})',
    repairModalTitle: 'Formreparation – förhandsgranskning',
    dryRunWrongShape: {
      one: 'Simulering: {count} kodning med fel form',
      other: 'Simulering: {count} kodningar med fel form',
    },
    inconsistentShapeRemoved: {
      one: '{count} kodning med inkonsekvent form borttagen',
      other: '{count} kodningar med inkonsekvent form borttagna',
    },
    repairFailed: 'Kunde inte reparera formerna: {error}',
  },
};
