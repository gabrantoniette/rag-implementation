import { writeFileSync } from 'node:fs';
import { drawTextCanvas, drawTextRgb, encodeBmp } from './images.js';
import { makeDocx, makePptx, makeXlsx } from './office.js';
import { makePdf } from './pdf.js';

/** One generated file per supported format, with a gold sentence and a query that should find it. */
export interface FormatFixture {
  format: string;
  file: string;
  gold: string;
  query: string;
  /** Expected rendered locator of the gold chunk. */
  locator: string;
}

const FILLER = [
  'The club newsletter also lists training times for the junior squads.',
  'Volunteers help with ticketing and stewarding on match days.',
  'Kit sponsorship was renewed for another three seasons.',
] as const;

/** Writes every fixture into `dir` (inside the project) and returns their descriptions. */
export async function writeFormatFixtures(dir: string): Promise<FormatFixture[]> {
  const out: FormatFixture[] = [];
  const add = (
    format: string,
    name: string,
    data: string | Uint8Array,
    gold: string,
    query: string,
    locator: string,
  ) => {
    const file = `${dir}/${name}`;
    writeFileSync(file, data);
    out.push({ format, file, gold, query, locator });
  };

  add(
    'md',
    'rowing.md',
    `# Rowing notes\n## Boat race\n${FILLER[0]}\n\nThe Oxbridge boat race course is 6.8 kilometres long.\n\n## Training\n${FILLER[1]}`,
    'The Oxbridge boat race course is 6.8 kilometres long.',
    'How long is the Oxbridge boat race course?',
    'Markdown section',
  );
  add(
    'txt',
    'cricket.txt',
    `${FILLER[0]}\n\nA cricket test match can last up to five days of play.\n\n${FILLER[2]}`,
    'A cricket test match can last up to five days of play.',
    'How many days can a test match in cricket last?',
    'paragraphs 1-3',
  );
  add(
    'html',
    'darts.html',
    `<html><head><title>Darts guide</title></head><body><nav>Home</nav><h1>Darts guide</h1><h2>Scoring</h2><p>${FILLER[1]}</p><p>The highest checkout in darts is 170, finished with treble twenty, treble twenty and bullseye.</p></body></html>`,
    'The highest checkout in darts is 170',
    'What is the highest possible checkout in darts?',
    'HTML section',
  );
  add(
    'csv',
    'marathons.csv',
    'city,course_record_holder,record_time\nBerlin,Eliud Kipchoge,2:01:09\nChicago,Kelvin Kiptum,2:00:35\nLondon,Kelvin Kiptum,2:01:25\n',
    'city: Chicago; course_record_holder: Kelvin Kiptum; record_time: 2:00:35',
    'Who holds the Chicago marathon course record?',
    'rows 1-3',
  );
  add(
    'tsv',
    'velodromes.tsv',
    'velodrome\tcity\ttrack_length\nLee Valley\tLondon\t250 m\nVigorelli\tMilan\t397 m\n',
    'velodrome: Vigorelli; city: Milan; track_length: 397 m',
    'How long is the track at the Vigorelli velodrome?',
    'rows 1-2',
  );
  add(
    'json',
    'rugby.json',
    JSON.stringify([
      { team: 'All Blacks', haka: 'Ka Mate' },
      { team: 'Springboks', nickname: 'Bokke' },
    ]),
    'team: All Blacks; haka: Ka Mate',
    'Which haka do the All Blacks perform?',
    'records 1-2',
  );
  add(
    'jsonl',
    'ski.jsonl',
    '{"event":"downhill","fact":"Downhill racers can exceed 130 km/h on the Lauberhorn course"}\n{"event":"slalom","fact":"Slalom gates alternate red and blue"}\n',
    'Downhill racers can exceed 130 km/h on the Lauberhorn course',
    'How fast do downhill skiers go at the Lauberhorn?',
    'records 1-2',
  );
  add(
    'pdf',
    'golf.pdf',
    makePdf([
      { lines: [FILLER[2]] },
      { lines: ['The Masters golf tournament winner receives a green jacket.', FILLER[0]] },
    ]),
    'The Masters golf tournament winner receives a green jacket.',
    'What does the winner of the Masters get to wear?',
    'page 2',
  );
  add(
    'pdf (OCR)',
    'scanned-boxing.pdf',
    makePdf([
      {
        image: drawTextRgb(['A professional boxing round lasts three minutes.'], { fontSize: 44 }),
      },
    ]),
    'boxing round lasts three minutes',
    'How long is a round in professional boxing?',
    'page 1 (OCR)',
  );
  add(
    'srt',
    'commentary.srt',
    '1\n00:00:01,000 --> 00:00:04,000\nThe goalkeeper saved the penalty in the ninetieth minute.\n\n2\n00:00:04,500 --> 00:00:07,000\nThe crowd is on its feet.\n',
    'The goalkeeper saved the penalty in the ninetieth minute.',
    'When did the keeper stop the spot kick?',
    '00:00:01-00:00:07',
  );
  add(
    'vtt',
    'interview.vtt',
    'WEBVTT\n\n00:00:02.000 --> 00:00:05.000\nThe coach said the team will rest two starters on Sunday.\n',
    'The coach said the team will rest two starters on Sunday.',
    'Which players will the coach rest?',
    '00:00:02-00:00:05',
  );
  add(
    'docx',
    'climbing.docx',
    await makeDocx('Climbing handbook', [
      { heading: 'Grades', level: 1 },
      { paragraph: 'Bouldering problems in this gym are graded from V0 to V10.' },
      { paragraph: FILLER[1] },
    ]),
    'Bouldering problems in this gym are graded from V0 to V10.',
    'What grading scale does the bouldering gym use?',
    'Word section',
  );
  add(
    'xlsx',
    'league.xlsx',
    await makeXlsx('Hockey league', [
      {
        name: 'Table',
        rows: [
          ['Team', 'Points'],
          ['Ice Wolves', 88],
          ['Polar Bears', 71],
        ],
      },
    ]),
    'Team: Ice Wolves; Points: 88',
    'How many points did the Ice Wolves get?',
    "Sheet 'Table' rows 2-3",
  );
  add(
    'pptx',
    'season.pptx',
    await makePptx('Season deck', [
      { title: 'Overview', body: [FILLER[2]] },
      {
        title: 'Attendance',
        body: ['Average attendance rose to 41,000'],
        notes: 'Mention that the new stand opened in March.',
      },
    ]),
    'Mention that the new stand opened in March.',
    'When did the new stand open?',
    'slide 2',
  );
  const sign = drawTextCanvas(['Gate C opens two hours before kick-off'], { fontSize: 48 });
  add(
    'png',
    'gate-sign.png',
    new Uint8Array(await sign.encode('png')),
    'Gate C opens two hours before kick-off',
    'When does Gate C open before the match?',
    'image',
  );
  add(
    'jpg',
    'gate-sign.jpg',
    new Uint8Array(await sign.encode('jpeg', 95)),
    'Gate C opens two hours before kick-off',
    'Gate C opening time before kick-off',
    'image',
  );
  add(
    'webp',
    'gate-sign.webp',
    new Uint8Array(await sign.encode('webp', 100)),
    'Gate C opens two hours before kick-off',
    'What time does gate C open?',
    'image',
  );
  const img = sign.getContext('2d').getImageData(0, 0, sign.width, sign.height);
  add(
    'bmp',
    'gate-sign.bmp',
    encodeBmp(sign.width, sign.height, img.data),
    'Gate C opens two hours before kick-off',
    'Gate C hours before kick-off',
    'image',
  );
  add(
    'mp3 (sidecar)',
    'pressconf.mp3',
    new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]),
    'The striker will miss the final with a hamstring injury.',
    'Why will the striker miss the final?',
    '00:00:03-00:00:06',
  );
  writeFileSync(
    `${dir}/pressconf.srt`,
    '1\n00:00:03,000 --> 00:00:06,000\nThe striker will miss the final with a hamstring injury.\n',
  );
  return out;
}
