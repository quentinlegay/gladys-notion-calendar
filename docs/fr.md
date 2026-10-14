# Notion Calendar

Retrouvez dans Gladys les bases Notion que vous affichez dans
[Notion Calendar](https://www.notion.com/product/calendar) : planning d'équipe,
tâches avec échéance, calendrier éditorial, voyages… Les événements
apparaissent dans la vue calendrier de Gladys, déclenchent le rappel
« Un événement va commencer », alimentent l'assistant et deux widgets de
tableau de bord.

## Fonctionnement

```
Bases Notion (propriété date)  ──API Notion──>  cette intégration  ──>  calendriers Gladys
```

Notion Calendar n'a pas d'API publique : il affiche les bases Notion qui ont
une propriété **date**. L'intégration lit ces mêmes bases avec l'API Notion,
puis :

- chaque base (source de données) ayant une propriété date devient un
  **calendrier** Gladys, du nom de la base ;
- chaque page datée devient un **événement** : son titre, sa date (sur la
  journée ou avec horaire), son lien Notion et, si la base a une propriété
  texte `Lieu` / `Location` / `Ort` / `Lugar`, son lieu.

La synchronisation va de Notion vers Gladys, toutes les 15 minutes par défaut.
Une page supprimée ou dont la date est vidée disparaît de Gladys à la
synchronisation suivante. Seule l'action de scène **Ajouter un événement
Notion** écrit dans Notion.

Les rendez-vous Google ou Outlook que Notion Calendar affiche aussi ne passent
pas par Notion : utilisez pour eux l'intégration CalDAV ou Google de Gladys.

## Installation

### 1. Créer une intégration Notion (une fois par personne)

1. Ouvrez [Mes intégrations Notion](https://www.notion.so/profile/integrations)
   et créez une **intégration interne** dans votre espace de travail.
2. Capacités : **Lire le contenu** suffit. Cochez aussi **Insérer du
   contenu** pour utiliser l'action de scène « Ajouter un événement Notion ».
3. Copiez le **secret** de l'intégration (il commence par `ntn_`).
4. Sur chaque base à synchroniser, ouvrez le menu **•••** → **Connexions** et
   ajoutez votre intégration. Une base non partagée reste invisible.

### 2. Réglages de l'intégration (administrateur)

Dans l'onglet **Configuration** :

| Réglage                       | Défaut | Rôle                                               |
| ----------------------------- | ------ | -------------------------------------------------- |
| Intervalle de synchronisation | 15 min | Fréquence de lecture de Notion (5 min minimum)     |
| Jours conservés dans le passé | 30     | Les événements plus anciens sont retirés de Gladys |
| Jours synchronisés à l'avance | 90     | Horizon de la vue, des rappels et des widgets      |

### 3. Activer « Mes calendriers » (chaque utilisateur)

Les calendriers sont des données personnelles : chaque utilisateur de Gladys
active l'intégration pour lui-même, avec son propre secret Notion, dans le bloc
**Mes calendriers** de la page de l'intégration.

- **Secret de l'intégration Notion** : le secret copié à l'étape 1.
- **Bases (facultatif)** : liens ou identifiants des bases à synchroniser,
  séparés par des virgules. Laissez vide pour synchroniser toutes les bases
  partagées avec l'intégration.
- **Propriété date (facultatif)** : nom de la propriété à utiliser quand une
  base en a plusieurs (par ex. `Échéance`). Vide : la première propriété date
  de la base.

Le bouton **Tester les comptes Notion** de l'onglet Configuration indique,
pour chaque utilisateur, combien de bases datées son secret peut lire.

### 4. Partager les calendriers utiles

Un calendrier synchronisé est **privé** au départ : seul son propriétaire le
voit. Partagez-le avec la maison (interrupteur **Partagé**) pour qu'il soit
visible sur les tableaux de bord, dans les scènes et par les autres membres.
L'interrupteur **Synchronisé** suspend un calendrier sans le supprimer.

## Scènes

### Déclencheurs

| Déclencheur                 | Quand                                                     | Variables                                     |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| **Événement Notion ajouté** | Une page datée apparaît dans un calendrier Notion partagé | `calendar`, `name`, `start`, `all_day`, `url` |
| **Échec de synchro Notion** | Un compte cesse de se synchroniser (jeton révoqué, base…) | `user`, `error`                               |

Le déclencheur « Événement Notion ajouté » peut être filtré sur le **nom du
calendrier** (le nom de la base Notion). Il ne se déclenche pas à la toute
première synchronisation d'un compte, ni pour les événements créés par l'action
de scène ci-dessous.

Le déclencheur natif de Gladys **Un événement va commencer** fonctionne aussi
sur les calendriers Notion partagés.

### Actions

| Action                                  | Champs                            | Sorties                                                      |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| **Synchroniser les calendriers Notion** | —                                 | `calendars`, `events`, `success`                             |
| **Ajouter un événement Notion**         | calendrier, nom, début, fin, lieu | `created`, `url`                                             |
| **Lire le prochain événement Notion**   | calendrier (vide : tous)          | `found`, `name`, `start`, `minutes_until`, `calendar`, `url` |

- **Début / fin** : une date (`2026-10-12`) pour un événement sur la journée,
  ou une date-heure avec fuseau (`2026-10-12T09:00:00+02:00`). Les variables
  de scène sont acceptées.
- Les actions ne voient que les calendriers **partagés**.

Exemple : chaque matin à 7 h, « Lire le prochain événement Notion », puis si
`found` est vrai, faire annoncer `{{name}}` par l'assistant.

## Widgets

| Widget            | Contenu                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| **Agenda Notion** | Les prochains événements (1 à 8), filtrables par calendrier, avec lien Notion    |
| **Résumé Notion** | Événements dans les 24 h et 7 jours, délai avant le prochain, état de la synchro |

Les deux widgets proposent un bouton **Synchroniser** et n'affichent que les
calendriers partagés (un tableau de bord peut être affiché sur un écran
public).

## Dépannage

- **« Notion a refusé le jeton »** : le secret a été régénéré ou
  l'intégration supprimée. Copiez le nouveau secret dans Mes calendriers.
- **« Une base n'est pas partagée »** : une base listée dans « Bases » n'est
  pas connectée à l'intégration (••• → Connexions), ou le lien est faux.
- **Une base n'apparaît pas** : elle n'a pas de propriété date, ou elle n'est
  pas partagée avec l'intégration.
- **Un événement de plus de 90 jours qui déborde sur la période** n'est pas
  synchronisé : seules les pages qui commencent au plus 90 jours avant la
  période sont lues.
- Les journaux de l'intégration (onglet Supervision) détaillent chaque
  synchronisation ; le secret Notion n'y figure jamais.

## Confidentialité

Le secret Notion de chaque utilisateur est conservé par Gladys sans jamais être réaffiché dans l'interface, et
n'est envoyé qu'à `api.notion.com`. L'intégration ne lit que les bases que
vous avez explicitement partagées avec votre intégration Notion.
