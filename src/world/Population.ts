import type { Citizen, Gender, Job, Look, Personality } from '../entities/Citizen.js';
import type { Point } from '../entities/geometry.js';

/**
 * The fixed cast of the town: forty people in sixteen households (SPEC.md 2.4).
 *
 * Families share a house. Every value here is written down rather than rolled,
 * so the same people live in the same houses every time the town opens.
 */

/** Which building each job happens in. Doctors practise from the office block. */
export const WORKPLACE_BY_JOB: Record<Job, string | undefined> = {
  Teacher: 'school',
  Baker: 'bakery',
  Shopkeeper: 'supermarket',
  'Office Worker': 'office',
  Doctor: 'office',
  'Cafe Worker': 'cafe',
  'Delivery Driver': 'supermarket',
  Student: 'school',
  Retired: undefined,
};

interface Person {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  job: Job;
  personality: Personality;
}

interface Household {
  homeId: string;
  members: Person[];
  /** Ids of the two adults who are married, if any. */
  couple?: [string, string];
}

const p = (
  id: string,
  name: string,
  age: number,
  gender: Gender,
  job: Job,
  social: number,
  energy: number,
  outdoorPreference: number,
  workPreference: number,
): Person => ({
  id,
  name,
  age,
  gender,
  job,
  personality: { social, energy, outdoorPreference, workPreference },
});

export const HOUSEHOLDS: readonly Household[] = [
  {
    homeId: 'house-03',
    couple: ['tom', 'sarah'],
    members: [
      p('tom', 'Tom', 38, 'male', 'Baker', 55, 70, 45, 75),
      p('sarah', 'Sarah', 36, 'female', 'Teacher', 75, 60, 60, 70),
      p('emma', 'Emma', 9, 'female', 'Student', 80, 90, 85, 40),
      p('leo', 'Leo', 7, 'male', 'Student', 65, 95, 90, 30),
    ],
  },
  {
    homeId: 'house-16',
    couple: ['ruth', 'harold'],
    members: [
      p('ruth', 'Ruth', 67, 'female', 'Retired', 70, 40, 75, 20),
      p('harold', 'Harold', 70, 'male', 'Retired', 45, 35, 80, 20),
    ],
  },
  {
    homeId: 'house-06',
    couple: ['oscar', 'lena'],
    members: [
      p('oscar', 'Oscar', 29, 'male', 'Office Worker', 60, 65, 35, 80),
      p('lena', 'Lena', 28, 'female', 'Cafe Worker', 85, 70, 55, 60),
    ],
  },
  {
    homeId: 'house-13',
    couple: ['mia', 'daniel'],
    members: [
      p('mia', 'Mia', 41, 'female', 'Doctor', 50, 55, 50, 90),
      p('daniel', 'Daniel', 43, 'male', 'Office Worker', 40, 50, 30, 65),
      p('noah', 'Noah', 14, 'male', 'Student', 60, 80, 70, 45),
    ],
  },
  {
    homeId: 'house-08',
    couple: ['grace', 'paul'],
    members: [
      p('grace', 'Grace', 52, 'female', 'Shopkeeper', 70, 60, 40, 80),
      p('paul', 'Paul', 54, 'male', 'Delivery Driver', 45, 65, 60, 70),
      p('ivy', 'Ivy', 17, 'female', 'Student', 75, 70, 50, 55),
    ],
  },
  {
    homeId: 'house-21',
    couple: ['ada', 'ben'],
    members: [
      p('ada', 'Ada', 33, 'female', 'Teacher', 65, 60, 65, 75),
      p('ben', 'Ben', 34, 'male', 'Baker', 35, 75, 40, 85),
    ],
  },
  {
    homeId: 'house-11',
    couple: ['clara', 'walter'],
    members: [
      p('clara', 'Clara', 61, 'female', 'Retired', 60, 45, 70, 25),
      p('walter', 'Walter', 63, 'male', 'Office Worker', 40, 50, 45, 70),
    ],
  },
  {
    homeId: 'house-25',
    couple: ['finn', 'nora'],
    members: [
      p('finn', 'Finn', 26, 'male', 'Delivery Driver', 55, 80, 70, 60),
      p('nora', 'Nora', 25, 'female', 'Cafe Worker', 90, 75, 60, 55),
    ],
  },
  {
    homeId: 'house-18',
    couple: ['hugo', 'elin'],
    members: [
      p('hugo', 'Hugo', 45, 'male', 'Shopkeeper', 50, 55, 35, 85),
      p('elin', 'Elin', 44, 'female', 'Office Worker', 65, 60, 55, 70),
      p('max', 'Max', 11, 'male', 'Student', 70, 90, 80, 35),
      p('zoe', 'Zoe', 8, 'female', 'Student', 85, 85, 90, 40),
    ],
  },
  {
    homeId: 'house-28',
    members: [p('june', 'June', 72, 'female', 'Retired', 55, 30, 65, 15)],
  },
  {
    homeId: 'house-01',
    couple: ['rex', 'faye'],
    members: [
      p('rex', 'Rex', 39, 'male', 'Office Worker', 45, 55, 40, 75),
      p('faye', 'Faye', 37, 'female', 'Doctor', 60, 65, 45, 85),
      p('kai', 'Kai', 13, 'male', 'Student', 55, 85, 75, 50),
    ],
  },
  {
    homeId: 'house-14',
    couple: ['olga', 'sam'],
    members: [
      p('olga', 'Olga', 58, 'female', 'Teacher', 60, 50, 55, 80),
      p('sam', 'Sam', 59, 'male', 'Retired', 50, 45, 70, 30),
    ],
  },
  {
    homeId: 'house-30',
    couple: ['iris', 'cole'],
    members: [
      p('iris', 'Iris', 48, 'female', 'Office Worker', 55, 55, 50, 70),
      p('cole', 'Cole', 50, 'male', 'Shopkeeper', 40, 60, 45, 80),
    ],
  },
  {
    homeId: 'apartment-01',
    members: [
      p('ivo', 'Ivo', 24, 'male', 'Office Worker', 80, 75, 50, 55),
      p('mila', 'Mila', 27, 'female', 'Shopkeeper', 65, 65, 45, 70),
      p('theo', 'Theo', 31, 'male', 'Cafe Worker', 75, 70, 60, 60),
    ],
  },
  {
    homeId: 'apartment-02',
    members: [
      p('nina', 'Nina', 30, 'female', 'Office Worker', 50, 60, 40, 80),
      p('otto', 'Otto', 35, 'male', 'Baker', 30, 70, 35, 85),
    ],
  },
  {
    homeId: 'apartment-03',
    members: [
      p('vera', 'Vera', 68, 'female', 'Retired', 65, 40, 60, 20),
      p('jonas', 'Jonas', 22, 'male', 'Office Worker', 85, 80, 65, 50),
      p('luca', 'Luca', 26, 'male', 'Delivery Driver', 60, 75, 70, 60),
    ],
  },
];

export const POPULATION_SIZE = 40;

/** A few friendships beyond colleagues, so the social graph is not just work. */
const FRIEND_PAIRS: ReadonlyArray<[string, string]> = [
  ['ruth', 'clara'],
  ['harold', 'sam'],
  ['june', 'vera'],
  ['lena', 'nora'],
  ['oscar', 'ivo'],
  ['emma', 'zoe'],
  ['leo', 'max'],
  ['noah', 'kai'],
  ['ivy', 'mila'],
  ['tom', 'ben'],
  ['grace', 'olga'],
  ['finn', 'luca'],
  ['jonas', 'theo'],
  ['iris', 'elin'],
];

const SKIN_COLORS = [0xe9c2a0, 0xd5a27a, 0xf0d2b4, 0xa4704f, 0xc48b66, 0x8d5a3b];
const HAIR_COLORS = [0x4a3627, 0x2b2320, 0xb58a5a, 0x8a6a4c, 0xd8c4a5, 0x5d5a58, 0xa0522d];
const SHIRT_COLORS = [
  0xd9604a, 0x4a7fd9, 0xe0a53c, 0x5fae7a, 0xa96fc4, 0xe6a15c, 0x8faf8f, 0xc9705f, 0x6f9a7a,
  0xd4b483, 0x7c8a9a, 0xb56576, 0x4f7fa8, 0xe09aa6, 0x9c6b4a, 0x6a8caf,
];
const TROUSER_COLORS = [0x5c6572, 0x8b7d6b, 0x3f4a5c, 0x6f6a5f, 0x7c8a9a, 0x4d4a45];

/** Deterministic look from the position in the cast list and the age. */
function lookFor(index: number, person: Person): Look {
  const child = person.age < 16;
  const elderly = person.age >= 60;
  return {
    skin: SKIN_COLORS[(index * 5) % SKIN_COLORS.length],
    hair: elderly ? HAIR_COLORS[4 + (index % 2)] : HAIR_COLORS[(index * 3) % 5],
    shirt: SHIRT_COLORS[index % SHIRT_COLORS.length],
    trousers: TROUSER_COLORS[(index * 7) % TROUSER_COLORS.length],
    hairCut: person.gender === 'female' ? 0.62 + (index % 3) * 0.05 : 0.38 + (index % 3) * 0.05,
    height: child ? 0.62 + (person.age - 7) * 0.03 : elderly ? 0.94 : 0.96 + (index % 4) * 0.02,
  };
}

/** Builds the forty citizens, all starting asleep at home. */
export function createPopulation(doorOf: (buildingId: string) => Point): Citizen[] {
  const citizens: Citizen[] = [];
  const byId = new Map<string, Citizen>();
  let index = 0;

  for (const household of HOUSEHOLDS) {
    for (const person of household.members) {
      const citizen: Citizen = {
        id: person.id,
        name: person.name,
        age: person.age,
        gender: person.gender,
        job: person.job,
        personality: person.personality,
        homeId: household.homeId,
        family: { parents: [], children: [], siblings: [] },
        friends: [],
        look: lookFor(index, person),
        walkSpeed: person.age < 16 ? 4.6 : person.age >= 60 ? 3.6 : 4.4,
        activity: 'Sleep',
        place: { kind: 'building', id: household.homeId },
        position: { ...doorOf(household.homeId) },
        heading: 0,
        distanceWalked: 0,
        path: [],
        pathIndex: 0,
        plan: [],
        planIndex: 0,
        planDay: 0,
        activityUntil: 0,
        socialNeed: 0,
        lateToday: 0,
      };
      const workplace = WORKPLACE_BY_JOB[person.job];
      if (workplace) {
        citizen.workplaceId = workplace;
      }
      citizens.push(citizen);
      byId.set(citizen.id, citizen);
      index += 1;
    }
  }

  linkFamilies(byId);
  linkFriends(citizens, byId);
  return citizens;
}

/** Spouses, parents, children and siblings, from the household table. */
function linkFamilies(byId: Map<string, Citizen>): void {
  for (const household of HOUSEHOLDS) {
    const adults = household.members.filter((member) => member.age >= 18).map((m) => m.id);
    const children = household.members.filter((member) => member.age < 18).map((m) => m.id);

    if (household.couple) {
      const [a, b] = household.couple;
      (byId.get(a) as Citizen).family.spouse = b;
      (byId.get(b) as Citizen).family.spouse = a;
    }

    // Children belong to the couple, not to lodgers sharing a flat.
    const parents = household.couple ? [...household.couple] : adults.slice(0, 0);
    for (const childId of children) {
      const child = byId.get(childId) as Citizen;
      child.family.parents = [...parents];
      child.family.siblings = children.filter((other) => other !== childId);
      for (const parentId of parents) {
        (byId.get(parentId) as Citizen).family.children.push(childId);
      }
    }
  }
}

/** Colleagues at the same workplace, plus the hand picked pairs above. */
function linkFriends(citizens: Citizen[], byId: Map<string, Citizen>): void {
  const family = (citizen: Citizen): Set<string> =>
    new Set([
      citizen.family.spouse ?? '',
      ...citizen.family.parents,
      ...citizen.family.children,
      ...citizen.family.siblings,
    ]);

  for (const citizen of citizens) {
    const kin = family(citizen);
    for (const other of citizens) {
      const colleagues =
        other.id !== citizen.id &&
        citizen.workplaceId !== undefined &&
        other.workplaceId === citizen.workplaceId &&
        // Pupils and staff share a building, not a friendship.
        (citizen.job === 'Student') === (other.job === 'Student');
      if (colleagues && !kin.has(other.id) && citizen.friends.length < 3) {
        citizen.friends.push(other.id);
      }
    }
  }

  for (const [a, b] of FRIEND_PAIRS) {
    const first = byId.get(a) as Citizen;
    const second = byId.get(b) as Citizen;
    if (!first.friends.includes(b)) {
      first.friends.push(b);
    }
    if (!second.friends.includes(a)) {
      second.friends.push(a);
    }
  }
}
