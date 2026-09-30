/** Telugu, for the screens beyond sign-in and home. Keys are the English text used in the code. */
const te: Record<string, string> = {
  // Words shown inside sentences
  'pending': 'పెండింగ్‌లో ఉన్న', 'approved': 'ఆమోదించిన', 'rejected': 'తిరస్కరించిన', 'requested': 'అభ్యర్థించిన', 'submitted': 'సమర్పించిన', 'open': 'తెరిచి ఉన్న', 'reviewed': 'సమీక్షించిన', 'dismissed': 'కొట్టివేసిన',

  // Shared parts
  'This picture needs at least {n}% dimming for text to stay readable.': 'అక్షరాలు స్పష్టంగా చదవడానికి ఈ చిత్రాన్ని కనీసం {n}% మసకబార్చాలి.',
  'Previous month': 'గత నెల', 'Next month': 'తదుపరి నెల', 'Today': 'ఈ రోజు', 'today': 'ఈ రోజు',
  'Choose a date to see what happened that day.': 'ఆ రోజు ఏం జరిగిందో చూడడానికి ఒక తేదీని ఎంచుకోండి.',
  'Leave request': 'సెలవు అభ్యర్థన', 'Note': 'గమనిక',
  'No messages from the school on this day.': 'ఈ రోజున పాఠశాల నుండి సందేశాలు లేవు.', 'Homework': 'హోంవర్క్',
  '{count} selected': '{count} ఎంచుకున్నారు', 'Clear': 'తొలగించండి',
  'Calculator': 'కాలిక్యులేటర్', 'Click the calculator, then type numbers and + − * / Enter': 'కాలిక్యులేటర్‌పై క్లిక్ చేసి, సంఖ్యలు మరియు + − * / Enter టైప్ చేయండి',
  'Send via': 'దీని ద్వారా పంపండి', '(not set up yet)': '(ఇంకా సెటప్ కాలేదు)',
  'WhatsApp only reaches people who opted in. If it fails, email is used instead.': 'వాట్సాప్ అంగీకరించిన వారికి మాత్రమే చేరుతుంది. విఫలమైతే బదులుగా ఈమెయిల్ వాడతారు.',
  'Class teacher': 'తరగతి ఉపాధ్యాయుడు', 'Monitor': 'మానిటర్', 'No class teacher': 'తరగతి ఉపాధ్యాయుడు లేరు', 'No class monitor': 'తరగతి మానిటర్ లేరు',
  'Teachers ({length})': 'ఉపాధ్యాయులు ({length})', 'No teachers yet.': 'ఇంకా ఉపాధ్యాయులు లేరు.', 'Students ({length})': 'విద్యార్థులు ({length})', 'No students yet.': 'ఇంకా విద్యార్థులు లేరు.',
  'Add to this class': 'ఈ తరగతికి జోడించండి', 'Select all shown': 'చూపిన అందరినీ ఎంచుకోండి', 'Remove {name} from {name2}?': '{name}ను {name2} నుండి తొలగించాలా?',
  'They lose access to this class\'s channels, homework and timetable.': 'వారికి ఈ తరగతి ఛానెల్‌లు, హోంవర్క్ మరియు సమయ పట్టికకు ప్రాప్యత పోతుంది.',
  'Cancel': 'రద్దు చేయండి', 'Remove': 'తొలగించండి', 'Teachers': 'ఉపాధ్యాయులు', 'Students': 'విద్యార్థులు',
  'Command bar': 'కమాండ్ బార్', 'Search pages, classes, people…': 'పేజీలు, తరగతులు, వ్యక్తులను వెతకండి…',
  'Nothing matches. Try a class name or a page like “fees”.': 'ఏదీ సరిపోలలేదు. తరగతి పేరు లేదా “ఫీజులు” వంటి పేజీ ప్రయత్నించండి.',
  'Appearance: theme, wallpaper, light / dark': 'రూపం: థీమ్, వాల్‌పేపర్, లేత / ముదురు', 'Sign out': 'సైన్ అవుట్',
  'Channel created': 'ఛానెల్ సృష్టించబడింది', 'Create channel': 'ఛానెల్ సృష్టించండి', 'in {name}': '{name}లో', 'Icon': 'ఐకాన్', 'Channel icon': 'ఛానెల్ ఐకాన్', 'Channel name': 'ఛానెల్ పేరు',
  'Accent colour': 'ప్రధాన రంగు', 'Use the default': 'డిఫాల్ట్ వాడండి',
  'Why they need leave': 'వారికి సెలవు ఎందుకు కావాలి', 'Decision note': 'నిర్ణయ గమనిక', 'Approve': 'ఆమోదించండి', 'Reject': 'తిరస్కరించండి',
  'No messages yet. Ask a question or add details here.': 'ఇంకా సందేశాలు లేవు. ఇక్కడ ప్రశ్న అడగండి లేదా వివరాలు జోడించండి.', 'Write a message…': 'సందేశం రాయండి…', 'Send': 'పంపండి',
  '(you)': '(మీరు)', 'Loading members…': 'సభ్యులు లోడ్ అవుతున్నారు…', 'No monitor': 'మానిటర్ లేరు', 'No members in this class yet.': 'ఈ తరగతిలో ఇంకా సభ్యులు లేరు.',
  'Photo for {name}': '{name} ఫోటో', 'Drag to position the face inside the frame, and use the slider to zoom.': 'ముఖాన్ని ఫ్రేమ్ లోపల ఉంచడానికి లాగండి, జూమ్ చేయడానికి స్లైడర్ వాడండి.',
  'Photo preview. Drag to move it.': 'ఫోటో ప్రివ్యూ. కదపడానికి లాగండి.',
  'File shared': 'ఫైల్ షేర్ చేయబడింది', 'PDF, images, Word or text, up to 10 MB': 'PDF, చిత్రాలు, Word లేదా టెక్స్ట్, 10 MB వరకు', 'No files shared yet.': 'ఇంకా ఫైళ్లు షేర్ చేయలేదు.',
  'Your school’s plan ends soon.': 'మీ పాఠశాల ప్లాన్ త్వరలో ముగుస్తుంది.', 'Your school’s plan has ended.': 'మీ పాఠశాల ప్లాన్ ముగిసింది.',
  'Your school’s plan has ended, so new students cannot be added.': 'మీ పాఠశాల ప్లాన్ ముగిసింది, కాబట్టి కొత్త విద్యార్థులను చేర్చలేరు.', 'See the plan': 'ప్లాన్ చూడండి',

  // Academic year and grades
  'From': 'నుండి', 'To': 'వరకు', 'Add': 'జోడించండి', 'Academic years and terms': 'విద్యా సంవత్సరాలు మరియు టర్మ్‌లు',
  'New exams join the term their date falls in, so report cards can be shown one term at a time.': 'కొత్త పరీక్షలు వాటి తేదీ ఉన్న టర్మ్‌లో చేరతాయి, కాబట్టి రిపోర్ట్ కార్డ్‌లను ఒక్కో టర్మ్ వారీగా చూపవచ్చు.',
  'No academic year yet. Add the first one above.': 'ఇంకా విద్యా సంవత్సరం లేదు. పైన మొదటిదాన్ని జోడించండి.', 'Current': 'ప్రస్తుత', 'Make current': 'ప్రస్తుతంగా చేయండి', '{startDate} to {endDate}': '{startDate} నుండి {endDate} వరకు',
  'Grade scale saved': 'గ్రేడ్ స్కేల్ సేవ్ అయింది', 'Back to the standard scale': 'ప్రామాణిక స్కేల్‌కు తిరిగి వచ్చింది', 'Grade scale': 'గ్రేడ్ స్కేల్', 'Standard': 'ప్రామాణిక',
  'A mark earns the grade of the highest band whose minimum it reaches. One band must start at 0. Changing the scale updates every report card.': 'ఒక మార్కు తాను చేరిన కనీస మార్కు గల అత్యధిక బ్యాండ్ యొక్క గ్రేడ్ పొందుతుంది. ఒక బ్యాండ్ 0 నుండి మొదలవ్వాలి. స్కేల్ మార్చితే ప్రతి రిపోర్ట్ కార్డ్ మారుతుంది.',
  'Minimum percent': 'కనీస శాతం', '% is': '% అంటే', 'Grade': 'గ్రేడ్', 'Remove band': 'బ్యాండ్ తొలగించండి', 'Add band': 'బ్యాండ్ జోడించండి', 'Save scale': 'స్కేల్ సేవ్ చేయండి', 'Use standard scale': 'ప్రామాణిక స్కేల్ వాడండి',
  'Academic year and grades': 'విద్యా సంవత్సరం మరియు గ్రేడ్‌లు',

  // Admissions
  'Application added for approval': 'దరఖాస్తు ఆమోదం కోసం జోడించబడింది', 'Student name': 'విద్యార్థి పేరు', 'Student email (login)': 'విద్యార్థి ఈమెయిల్ (లాగిన్)', 'Parent name': 'తల్లిదండ్రుల పేరు',
  'Parent email (login)': 'తల్లిదండ్రుల ఈమెయిల్ (లాగిన్)', 'Parent phone (+91…)': 'తల్లిదండ్రుల ఫోన్ (+91…)', 'Parent agreed to WhatsApp messages': 'తల్లిదండ్రులు వాట్సాప్ సందేశాలకు అంగీకరించారు',
  'Add application': 'దరఖాస్తు జోడించండి', 'Import CSV': 'CSV దిగుమతి చేయండి', 'Download template': 'టెంప్లేట్ డౌన్‌లోడ్ చేయండి',
  'Columns: studentName, studentEmail, parentName, parentEmail, parentPhone, relationship, class, whatsappOptIn (yes/no)': 'కాలమ్‌లు: studentName, studentEmail, parentName, parentEmail, parentPhone, relationship, class, whatsappOptIn (yes/no)',
  'Not processed:': 'ప్రాసెస్ కానివి:', 'Select all': 'అన్నీ ఎంచుకోండి', 'Select row': 'వరుసను ఎంచుకోండి', 'New accounts created': 'కొత్త ఖాతాలు సృష్టించబడ్డాయి',
  'Temporary passwords are shown only now and are not stored. Download or copy them and hand them out. Each person must change theirs after first sign-in.': 'తాత్కాలిక పాస్‌వర్డ్‌లు ఇప్పుడే మాత్రమే చూపబడతాయి, నిల్వ చేయబడవు. వాటిని డౌన్‌లోడ్ లేదా కాపీ చేసి పంచండి. ప్రతి ఒక్కరూ మొదటి సైన్ ఇన్ తర్వాత తమ పాస్‌వర్డ్ మార్చాలి.',
  'Name': 'పేరు', 'Temporary password': 'తాత్కాలిక పాస్‌వర్డ్', 'Download CSV': 'CSV డౌన్‌లోడ్ చేయండి',
  'No {status} applications. Add one above or import a CSV.': '{status} దరఖాస్తులు లేవు. పైన ఒకటి జోడించండి లేదా CSV దిగుమతి చేయండి.', 'No {status} applications.': '{status} దరఖాస్తులు లేవు.',

  // School overview
  'Attendance, last 14 days': 'హాజరు, గత 14 రోజులు', 'Percent present each day (days with no marks are blank)': 'ప్రతి రోజు హాజరైన శాతం (హాజరు నమోదు కాని రోజులు ఖాళీగా ఉంటాయి)',
  'No attendance has been marked in the last 14 days.': 'గత 14 రోజుల్లో హాజరు నమోదు కాలేదు.', 'Average result by subject': 'సబ్జెక్టు వారీగా సగటు ఫలితం', 'Approved results only': 'ఆమోదించిన ఫలితాలు మాత్రమే',
  'No approved results yet.': 'ఇంకా ఆమోదించిన ఫలితాలు లేవు.', 'Students with low attendance': 'తక్కువ హాజరు ఉన్న విద్యార్థులు', 'Under 75% over the last 30 days (3 or more days recorded)': 'గత 30 రోజుల్లో 75% కంటే తక్కువ (3 లేదా అంతకంటే ఎక్కువ రోజులు నమోదు)',
  'No students are below 75%.': '75% కంటే తక్కువ ఉన్న విద్యార్థులు లేరు.', 'Present': 'హాజరు', 'Days recorded': 'నమోదైన రోజులు',
  'Looking for things that need a decision? Open the approvals center.': 'నిర్ణయం అవసరమైనవి వెతుకుతున్నారా? ఆమోద కేంద్రాన్ని తెరవండి.',

  // Approvals
  '{succeeded} of {total} succeeded. Not processed:': '{total}లో {succeeded} విజయవంతం. ప్రాసెస్ కానివి:',
  'No {status} role requests. Requests submitted by clerks and teachers appear here for approval.': '{status} పాత్ర అభ్యర్థనలు లేవు. గుమస్తాలు మరియు ఉపాధ్యాయులు సమర్పించిన అభ్యర్థనలు ఆమోదం కోసం ఇక్కడ కనిపిస్తాయి.',
  'User': 'వినియోగదారు', 'Requested by': 'అభ్యర్థించినవారు', 'Requested role': 'అభ్యర్థించిన పాత్ర', 'Needs action': 'చర్య అవసరం',

  // Branding
  'Saved': 'సేవ్ అయింది', 'The logo must be a PNG or JPG picture': 'లోగో PNG లేదా JPG చిత్రం అయి ఉండాలి', 'The logo must be under 500 KB': 'లోగో 500 KB కంటే తక్కువ ఉండాలి',
  'Logo updated': 'లోగో నవీకరించబడింది', 'Logo removed': 'లోగో తొలగించబడింది', 'How your school looks on the sign-in page and across the app.': 'సైన్ ఇన్ పేజీలో మరియు యాప్ అంతటా మీ పాఠశాల ఎలా కనిపిస్తుంది.',
  'School name': 'పాఠశాల పేరు', 'Tagline': 'ట్యాగ్‌లైన్', '(shown under the name on the sign-in page)': '(సైన్ ఇన్ పేజీలో పేరు కింద చూపబడుతుంది)', 'e.g. Learning together': 'ఉదా: కలిసి నేర్చుకుందాం',
  'Logo': 'లోగో', 'School logo': 'పాఠశాల లోగో', 'PNG or JPG, up to 500 KB. A square picture on a plain background works best.': 'PNG లేదా JPG, 500 KB వరకు. సాదా నేపథ్యంపై చతురస్ర చిత్రం ఉత్తమం.',
  'Preview of your sign-in page': 'మీ సైన్ ఇన్ పేజీ ప్రివ్యూ',

  // Class channels
  'Announcement updated': 'ప్రకటన నవీకరించబడింది', 'Announcement deleted': 'ప్రకటన తొలగించబడింది', 'Announcement posted': 'ప్రకటన పోస్ట్ చేయబడింది', 'Title': 'శీర్షిక', 'Write an announcement…': 'ప్రకటన రాయండి…',
  'Mark as urgent': 'అత్యవసరంగా గుర్తించండి', 'Post': 'పోస్ట్ చేయండి', 'No announcements yet.': 'ఇంకా ప్రకటనలు లేవు.', 'Message': 'సందేశం',
  'People are not sent this again. It shows as edited.': 'దీన్ని మళ్లీ ఎవరికీ పంపరు. ఇది “సవరించబడింది” అని కనిపిస్తుంది.', 'Save': 'సేవ్ చేయండి', 'Edit': 'సవరించండి', 'Delete': 'తొలగించండి',
  'No linked children yet.': 'ఇంకా లింక్ చేసిన పిల్లలు లేరు.', 'Export CSV': 'CSV ఎగుమతి చేయండి', 'No students are enrolled in this class yet.': 'ఈ తరగతిలో ఇంకా విద్యార్థులు చేరలేదు.',
  'not yet saved': 'ఇంకా సేవ్ కాలేదు', 'Approved leave today': 'ఈ రోజు ఆమోదించిన సెలవు', 'Mark present': 'హాజరుగా గుర్తించండి', 'Mark absent': 'గైర్హాజరుగా గుర్తించండి', 'Mark late': 'ఆలస్యంగా గుర్తించండి',
  'Submitted': 'సమర్పించారు', 'Instructions': 'సూచనలు', 'Assign to classes': 'తరగతులకు కేటాయించండి', 'Assign homework': 'హోంవర్క్ ఇవ్వండి', 'No homework yet.': 'ఇంకా హోంవర్క్ లేదు.',
  'Due {dueDate}': 'గడువు {dueDate}', 'Submitted {value}': '{value} న సమర్పించారు', 'Your answer': 'మీ సమాధానం', 'Files': 'ఫైళ్లు', 'Missing': 'సమర్పించలేదు', 'Message not sent': 'సందేశం పంపబడలేదు',
  'No messages yet. Say hello to your class.': 'ఇంకా సందేశాలు లేవు. మీ తరగతికి హలో చెప్పండి.', 'Message the class…': 'తరగతికి సందేశం పంపండి…', 'Members': 'సభ్యులు', 'This channel no longer exists.': 'ఈ ఛానెల్ ఇక లేదు.',
  'The {channel} feature is built in a later phase. This channel is where it will live.': '{channel} ఫీచర్ తర్వాతి దశలో నిర్మించబడుతుంది. ఈ ఛానెల్ దాని స్థానం.',
  'Document published': 'పత్రం ప్రచురించబడింది', 'Forms, circulars and policies from the school office.': 'పాఠశాల కార్యాలయం నుండి ఫారమ్‌లు, సర్క్యులర్‌లు మరియు విధానాలు.', 'Title (optional)': 'శీర్షిక (ఐచ్ఛికం)', 'No documents yet.': 'ఇంకా పత్రాలు లేవు.',

  // Exams
  'Submitted for approval': 'ఆమోదం కోసం సమర్పించబడింది', 'Sent back by the principal: {reason}': 'ప్రిన్సిపాల్ తిప్పి పంపారు: {reason}', 'Columns: email, score (use AB for absent)': 'కాలమ్‌లు: email, score (గైర్హాజరు కోసం AB వాడండి)',
  'Score / {maxMarks}': 'మార్కులు / {maxMarks}', 'Absent': 'గైర్హాజరు', 'Save draft': 'డ్రాఫ్ట్ సేవ్ చేయండి', 'Save and submit for approval': 'సేవ్ చేసి ఆమోదం కోసం సమర్పించండి',
  'A score is outside 0 to {maxMarks}.': 'ఒక మార్కు 0 నుండి {maxMarks} పరిధి బయట ఉంది.', 'Exam created. Enter the marks below.': 'పరీక్ష సృష్టించబడింది. కింద మార్కులు నమోదు చేయండి.', 'Exam deleted': 'పరీక్ష తొలగించబడింది',
  'Exam name (e.g. Unit Test 1)': 'పరీక్ష పేరు (ఉదా: యూనిట్ టెస్ట్ 1)', 'Subject': 'సబ్జెక్టు', 'Maximum marks': 'గరిష్ట మార్కులు', 'Create exam': 'పరీక్ష సృష్టించండి', 'Delete {name}?': '{name}ను తొలగించాలా?', 'Reason (required)': 'కారణం (తప్పనిసరి)',

  // Fees
  'Loading fees…': 'ఫీజులు లోడ్ అవుతున్నాయి…', 'No fees for {name} yet.': '{name}కు ఇంకా ఫీజులు లేవు.', 'Fee structure for {name}': '{name} ఫీజు నిర్మాణం', '{length} fee(s)': '{length} ఫీజు(లు)',
  'Fee': 'ఫీజు', 'Amount': 'మొత్తం', 'Due': 'గడువు', 'Details': 'వివరాలు', 'Waiver sent to the principal': 'మాఫీ అభ్యర్థన ప్రిన్సిపాల్‌కు పంపబడింది', 'Payment received. A receipt is on its way.': 'చెల్లింపు అందింది. రసీదు పంపబడుతోంది.',
  'Fee title (e.g. Term 1)': 'ఫీజు శీర్షిక (ఉదా: టర్మ్ 1)', 'Amount ₹': 'మొత్తం ₹', 'Create invoices for class': 'తరగతికి ఇన్‌వాయిస్‌లు సృష్టించండి',
  'Remind students and parents about fees due soon or overdue. Runs by itself every day; nothing is sent twice.': 'త్వరలో గడువు ఉన్న లేదా గడువు దాటిన ఫీజుల గురించి విద్యార్థులకు మరియు తల్లిదండ్రులకు గుర్తు చేయండి. ప్రతిరోజూ దానంతట అదే నడుస్తుంది; ఏదీ రెండుసార్లు పంపబడదు.',
  'All classes': 'అన్ని తరగతులు', 'All statuses': 'అన్ని స్థితులు', 'Unpaid': 'చెల్లించలేదు', 'Overdue': 'గడువు దాటింది', 'Paid': 'చెల్లించారు', 'Waived': 'మాఫీ', 'Refunded': 'వాపసు చేయబడింది',
  'Select all unpaid': 'చెల్లించని అన్నింటినీ ఎంచుకోండి', 'Waiver pending': 'మాఫీ పెండింగ్', 'Waiver declined': 'మాఫీ తిరస్కరించబడింది', 'Refund': 'వాపసు', 'Request waiver': 'మాఫీ అభ్యర్థించండి',
  'Pay online': 'ఆన్‌లైన్‌లో చెల్లించండి', 'Pay at the school office': 'పాఠశాల కార్యాలయంలో చెల్లించండి', 'Mark paid': 'చెల్లించినట్లు గుర్తించండి', 'Mark {size} invoice(s) paid?': '{size} ఇన్‌వాయిస్(లు) చెల్లించినట్లు గుర్తించాలా?',
  'Total {value}. Receipts go to students and parents.': 'మొత్తం {value}. రసీదులు విద్యార్థులకు మరియు తల్లిదండ్రులకు వెళ్తాయి.', 'Reference (optional)': 'రిఫరెన్స్ (ఐచ్ఛికం)',
  'The student and parents are told. This cannot be undone.': 'విద్యార్థికి మరియు తల్లిదండ్రులకు తెలియజేయబడుతుంది. దీన్ని రద్దు చేయలేరు.',
  'Amount to refund in rupees. Leave empty to refund all {amount} that is left.': 'వాపసు చేసే మొత్తం రూపాయల్లో. మిగిలిన {amount} మొత్తం వాపసు చేయడానికి ఖాళీగా వదలండి.',
  'Full amount': 'పూర్తి మొత్తం', 'Request a fee waiver': 'ఫీజు మాఫీ అభ్యర్థన', 'Send request': 'అభ్యర్థన పంపండి', 'Refund {amount}?': '{amount} వాపసు చేయాలా?', 'Refund {amount} (all that is left)?': '{amount} వాపసు చేయాలా (మిగిలినదంతా)?',
  '{student}: {title} ({amount}). The principal decides.': '{student}: {title} ({amount}). ప్రిన్సిపాల్ నిర్ణయిస్తారు.',

  // ID cards
  'Back': 'వెనక్కి', 'Print {length} card(s)': '{length} కార్డ్(లు) ప్రింట్ చేయండి', 'Not generated:': 'సృష్టించనివి:', 'Class:': 'తరగతి:', 'Select students, generate their cards, then print the sheet.': 'విద్యార్థులను ఎంచుకుని, వారి కార్డ్‌లు సృష్టించి, షీట్ ప్రింట్ చేయండి.',
  'Search by name or email': 'పేరు లేదా ఈమెయిల్‌తో వెతకండి', 'No students found.': 'విద్యార్థులు కనబడలేదు.', 'Photo': 'ఫోటో',

  // Leave
  'Leave request sent': 'సెలవు అభ్యర్థన పంపబడింది', 'Reason': 'కారణం', 'For': 'ఎవరికి', 'Dates': 'తేదీలు', 'Requesters are notified.': 'అభ్యర్థించిన వారికి తెలియజేయబడుతుంది.',

  // Roles, links, classes
  'Request submitted for approval': 'అభ్యర్థన ఆమోదం కోసం సమర్పించబడింది', 'Request a role change': 'పాత్ర మార్పు అభ్యర్థించండి', 'Select user…': 'వినియోగదారును ఎంచుకోండి…', 'Note (optional)': 'గమనిక (ఐచ్ఛికం)',
  'Submit request': 'అభ్యర్థన సమర్పించండి', 'My requests': 'నా అభ్యర్థనలు', 'You have not submitted any requests yet.': 'మీరు ఇంకా ఏ అభ్యర్థనలూ సమర్పించలేదు.', 'Link proposed for approval': 'లింక్ ఆమోదం కోసం ప్రతిపాదించబడింది',
  'Parent–student links': 'తల్లిదండ్రులు–విద్యార్థి లింక్‌లు', 'Parent…': 'తల్లిదండ్రులు…', 'Student…': 'విద్యార్థి…', 'Relationship': 'సంబంధం', 'Propose link': 'లింక్ ప్రతిపాదించండి',
  'No links yet. A parent only sees a child’s data after an approved link.': 'ఇంకా లింక్‌లు లేవు. లింక్ ఆమోదించిన తర్వాత మాత్రమే తల్లిదండ్రులకు పిల్లల డేటా కనిపిస్తుంది.', 'Revoke': 'ఉపసంహరించండి',
  'Class created': 'తరగతి సృష్టించబడింది', 'The classes you teach. Open one to see its students and choose the class monitor.': 'మీరు బోధించే తరగతులు. ఒకదాన్ని తెరిచి విద్యార్థులను చూడండి, తరగతి మానిటర్‌ను ఎంచుకోండి.',
  'e.g. Grade 9-B': 'ఉదా: తరగతి 9-B', 'Create': 'సృష్టించండి', 'Channels': 'ఛానెల్‌లు', 'Not assigned': 'కేటాయించలేదు',

  // Message reports
  'Conversations that someone reported. You can read only these, and each time you open one it is recorded in the audit log.': 'ఎవరైనా ఫిర్యాదు చేసిన సంభాషణలు. మీరు వీటిని మాత్రమే చదవగలరు, ప్రతిసారీ తెరిచినప్పుడు అది ఆడిట్ లాగ్‌లో నమోదవుతుంది.',
  'No {status} reports.': '{status} ఫిర్యాదులు లేవు.', 'Reported': 'ఫిర్యాదు చేశారు', 'Between': 'మధ్య', 'reported': 'ఫిర్యాదు చేశారు', 'Open': 'తెరిచి ఉంది', 'Reported conversation': 'ఫిర్యాదు చేసిన సంభాషణ', 'Their reason': 'వారి కారణం',
  'You are reading a private conversation because it was reported. This is recorded.': 'ఫిర్యాదు వచ్చినందున మీరు ఒక ప్రైవేట్ సంభాషణ చదువుతున్నారు. ఇది నమోదు చేయబడుతుంది.', 'Deleted by the sender': 'పంపినవారు తొలగించారు',
  'Note for the record (the person who reported sees it)': 'రికార్డు కోసం గమనిక (ఫిర్యాదు చేసినవారికి కనిపిస్తుంది)', 'No action needed': 'చర్య అవసరం లేదు', 'Mark reviewed': 'సమీక్షించినట్లు గుర్తించండి',

  // Direct messages
  '{value} · tap to download': '{value} · డౌన్‌లోడ్ కోసం నొక్కండి', 'New message': 'కొత్త సందేశం', 'Choose who you want to write to.': 'ఎవరికి రాయాలనుకుంటున్నారో ఎంచుకోండి.', 'Search by name': 'పేరుతో వెతకండి',
  'Reported. The school will look at it.': 'ఫిర్యాదు నమోదైంది. పాఠశాల దీన్ని పరిశీలిస్తుంది.', 'Tell us what is wrong. The person is not told who reported.': 'ఏం తప్పో చెప్పండి. ఎవరు ఫిర్యాదు చేశారో ఆ వ్యక్తికి చెప్పరు.', 'What happened?': 'ఏం జరిగింది?',
  'Reporting lets the school\'s reviewer read this conversation (the principal, or the admin if the principal is one of the two people). Nothing else of yours is opened. While it is open, messages here can\'t be edited or deleted.': 'ఫిర్యాదు చేస్తే పాఠశాల సమీక్షకుడు ఈ సంభాషణ చదవగలరు (ప్రిన్సిపాల్, లేదా ఆ ఇద్దరిలో ప్రిన్సిపాల్ ఒకరైతే అడ్మిన్). మీకు సంబంధించిన మరేదీ తెరవబడదు. ఇది తెరిచి ఉన్నంతవరకు ఇక్కడి సందేశాలను సవరించలేరు లేదా తొలగించలేరు.',
  'Choose which child this message is about': 'ఈ సందేశం ఏ పిల్లవాడి గురించో ఎంచుకోండి', 'Delete this message for both of you? This cannot be undone.': 'ఈ సందేశాన్ని మీ ఇద్దరికీ తొలగించాలా? దీన్ని రద్దు చేయలేరు.',
  'Unblocked': 'అన్‌బ్లాక్ చేయబడింది', 'Back to messages': 'సందేశాలకు తిరిగి వెళ్ళండి', 'typing…': 'టైప్ చేస్తున్నారు…', 'Conversation options': 'సంభాషణ ఎంపికలు', 'Report conversation': 'సంభాషణపై ఫిర్యాదు చేయండి',
  'This conversation has been reported and can be reviewed by the school. Messages in it can\'t be edited or deleted for now.': 'ఈ సంభాషణపై ఫిర్యాదు చేయబడింది, పాఠశాల దీన్ని సమీక్షించవచ్చు. ప్రస్తుతానికి దీనిలోని సందేశాలను సవరించలేరు లేదా తొలగించలేరు.',
  'Load earlier messages': 'పాత సందేశాలను లోడ్ చేయండి', 'No messages yet. Say hello to {value}.': 'ఇంకా సందేశాలు లేవు. {value}కు హలో చెప్పండి.', 'About': 'గురించి', 'This message was deleted': 'ఈ సందేశం తొలగించబడింది',
  'Message options': 'సందేశ ఎంపికలు', 'Under review': 'సమీక్షలో ఉంది', 'Report message': 'సందేశంపై ఫిర్యాదు చేయండి', '· edited': '· సవరించబడింది', 'Seen': 'చూశారు', 'Sent': 'పంపబడింది', '{value} is typing…': '{value} టైప్ చేస్తున్నారు…',
  'Uploading…': 'అప్‌లోడ్ అవుతోంది…', 'Which child is this about': 'ఇది ఏ పిల్లవాడి గురించి', 'Attach a file': 'ఫైల్ జత చేయండి', 'Attach a file (PDF, image, Word, text; up to 10 MB)': 'ఫైల్ జత చేయండి (PDF, చిత్రం, Word, టెక్స్ట్; 10 MB వరకు)',
  'You blocked {name}. Unblock to message again.': 'మీరు {name}ను బ్లాక్ చేశారు. మళ్లీ సందేశం పంపడానికి అన్‌బ్లాక్ చేయండి.', 'Unblock': 'అన్‌బ్లాక్ చేయండి', 'You can no longer message this person. You can still read this conversation.': 'మీరు ఇక ఈ వ్యక్తికి సందేశం పంపలేరు. ఈ సంభాషణ మాత్రం చదవవచ్చు.',
  'New': 'కొత్త', 'No conversations yet.': 'ఇంకా సంభాషణలు లేవు.', 'Start one': 'ఒకటి ప్రారంభించండి', 'Choose a conversation, or start a new one.': 'ఒక సంభాషణను ఎంచుకోండి, లేదా కొత్తది ప్రారంభించండి.',

  // Message wording (admin)
  'The wording of every message the school sends by email, WhatsApp and in the app. Change any of them here. The defaults stay available if you want to go back.': 'పాఠశాల ఈమెయిల్, వాట్సాప్ మరియు యాప్‌లో పంపే ప్రతి సందేశం పదజాలం. వీటిలో ఏదైనా ఇక్కడ మార్చండి. తిరిగి వెళ్లాలనుకుంటే డిఫాల్ట్‌లు అందుబాటులో ఉంటాయి.',
  'Changed': 'మార్చబడింది', 'Has urgent wording': 'అత్యవసర పదజాలం ఉంది', 'To: {audience}': 'ఎవరికి: {audience}', 'Saved. New messages use this wording.': 'సేవ్ అయింది. కొత్త సందేశాలు ఈ పదజాలం వాడతాయి.',
  'Go back to the default wording for this message?': 'ఈ సందేశానికి డిఫాల్ట్ పదజాలానికి తిరిగి వెళ్లాలా?', 'Back to the default': 'డిఫాల్ట్‌కు తిరిగి', 'Wording': 'పదజాలం', 'Used when:': 'ఎప్పుడు వాడతారు:',
  'Click to add a detail that is filled in for each person:': 'ప్రతి వ్యక్తికి నింపబడే వివరాన్ని జోడించడానికి క్లిక్ చేయండి:', 'Not available here: {value}. Use only the details above.': 'ఇక్కడ అందుబాటులో లేదు: {value}. పైన ఉన్న వివరాలను మాత్రమే వాడండి.',
  'Preview with example details': 'ఉదాహరణ వివరాలతో ప్రివ్యూ', '(no subject)': '(విషయం లేదు)', 'Close': 'మూసివేయండి',

  // Platform (super admin)
  'Copied': 'కాపీ అయింది', 'Could not copy. Select it and copy by hand.': 'కాపీ కాలేదు. దాన్ని ఎంచుకుని చేతితో కాపీ చేయండి.',
  'Give these sign-in details to {name}. The password is shown only once.': 'ఈ సైన్ ఇన్ వివరాలను {name}కు ఇవ్వండి. పాస్‌వర్డ్ ఒక్కసారి మాత్రమే చూపబడుతుంది.', 'Sign-in address': 'సైన్ ఇన్ చిరునామా', 'Copy': 'కాపీ చేయండి',
  'They choose their own password the first time they sign in.': 'మొదటిసారి సైన్ ఇన్ చేసేటప్పుడు వారు తమ పాస్‌వర్డ్‌ను తామే ఎంచుకుంటారు.', 'Done': 'పూర్తయింది', 'Add a school': 'పాఠశాలను జోడించండి',
  'This creates the school and its first admin, who then sets everything else up.': 'ఇది పాఠశాలను మరియు దాని మొదటి అడ్మిన్‌ను సృష్టిస్తుంది, వారు మిగతా అంతా సెటప్ చేస్తారు.', 'Address': 'చిరునామా', '(its own sign-in link)': '(దాని సొంత సైన్ ఇన్ లింక్)', '(optional)': '(ఐచ్ఛికం)',
  'First admin\'s name': 'మొదటి అడ్మిన్ పేరు', 'First admin\'s email': 'మొదటి అడ్మిన్ ఈమెయిల్', 'Changing it changes the school\'s sign-in link. Tell them if you do.': 'దీన్ని మారిస్తే పాఠశాల సైన్ ఇన్ లింక్ మారుతుంది. మారిస్తే వారికి చెప్పండి.',
  'Admins': 'అడ్మిన్‌లు', 'Deactivated': 'నిష్క్రియం', 'Reset password': 'పాస్‌వర్డ్ రీసెట్ చేయండి', 'No admins yet.': 'ఇంకా అడ్మిన్‌లు లేరు.', 'Add another admin': 'మరో అడ్మిన్‌ను జోడించండి', 'Add admin': 'అడ్మిన్‌ను జోడించండి', 'Add school': 'పాఠశాలను జోడించండి',
  'No schools yet. Add the first one.': 'ఇంకా పాఠశాలలు లేవు. మొదటిదాన్ని జోడించండి.', 'Active': 'క్రియాశీలం', 'Suspended': 'సస్పెండ్ చేయబడింది', '{people} people · {students} students · {teachers} teachers': '{people} మంది · {students} విద్యార్థులు · {teachers} ఉపాధ్యాయులు',
  'Manage': 'నిర్వహించండి', 'Sign-in page': 'సైన్ ఇన్ పేజీ', 'Suspend': 'సస్పెండ్ చేయండి', 'Reactivate': 'మళ్లీ ప్రారంభించండి', 'Suspend {name}?': '{name}ను సస్పెండ్ చేయాలా?',
  'Everyone at this school is signed out straight away and cannot sign in until you reactivate it. Nothing is deleted.': 'ఈ పాఠశాలలోని అందరూ వెంటనే సైన్ అవుట్ అవుతారు, మీరు మళ్లీ ప్రారంభించే వరకు సైన్ ఇన్ చేయలేరు. ఏదీ తొలగించబడదు.',
  'Plans': 'ప్లాన్‌లు', 'A plan sets how many students a school can have and what it pays each month. Give a plan to a school from its Manage panel. Schools with no plan have no limit.': 'ప్లాన్ ఒక పాఠశాలలో ఎంత మంది విద్యార్థులు ఉండవచ్చో, ప్రతి నెలా ఎంత చెల్లిస్తుందో నిర్ణయిస్తుంది. ఒక పాఠశాలకు దాని “నిర్వహించండి” ప్యానెల్ నుండి ప్లాన్ ఇవ్వండి. ప్లాన్ లేని పాఠశాలలకు పరిమితి లేదు.',
  '(not offered)': '(అందుబాటులో లేదు)', '{value} / month': '{value} / నెల', 'Plan name': 'ప్లాన్ పేరు', 'Student limit (0 = unlimited)': 'విద్యార్థి పరిమితి (0 = అపరిమితం)', 'Price per month (₹)': 'నెలకు ధర (₹)', 'Add plan': 'ప్లాన్ జోడించండి',
  'Edit plan': 'ప్లాన్ సవరించండి', 'Changes apply to every school on this plan straight away.': 'మార్పులు ఈ ప్లాన్‌లో ఉన్న ప్రతి పాఠశాలకు వెంటనే వర్తిస్తాయి.', 'Plan saved': 'ప్లాన్ సేవ్ అయింది', 'Loading plan…': 'ప్లాన్ లోడ్ అవుతోంది…',
  'Plan and billing': 'ప్లాన్ మరియు బిల్లింగ్', 'students': 'విద్యార్థులు', 'Plan': 'ప్లాన్', 'No plan (no limits)': 'ప్లాన్ లేదు (పరిమితులు లేవు)', 'Paid up to': 'చెల్లింపు వరకు', 'Record a payment received': 'అందిన చెల్లింపును నమోదు చేయండి',
  'It pays for the months after the school is currently paid up to, or from today if that has passed.': 'ఇది పాఠశాల ప్రస్తుతం చెల్లించిన తేదీ తర్వాతి నెలలకు చెల్లిస్తుంది, ఆ తేదీ దాటితే ఈ రోజు నుండి.',
  'Amount (₹)': 'మొత్తం (₹)', 'Months': 'నెలలు', 'Method': 'పద్ధతి', 'Reference': 'రిఫరెన్స్', 'Transaction id': 'లావాదేవీ ఐడి', 'Record payment': 'చెల్లింపు నమోదు చేయండి', 'Delete this school': 'ఈ పాఠశాలను తొలగించండి',
  'Deleting is permanent, so a school has to be suspended first. Suspend it from the schools list, then come back here.': 'తొలగింపు శాశ్వతం, కాబట్టి పాఠశాలను ముందుగా సస్పెండ్ చేయాలి. పాఠశాలల జాబితా నుండి సస్పెండ్ చేసి, ఇక్కడికి తిరిగి రండి.',
  'Permanently removes the school and everything in it: people, classes, records, messages and files. This cannot be undone. Ask the school to export its data first if it needs a copy.': 'పాఠశాలను మరియు దానిలోని అన్నింటినీ శాశ్వతంగా తొలగిస్తుంది: వ్యక్తులు, తరగతులు, రికార్డులు, సందేశాలు మరియు ఫైళ్లు. దీన్ని రద్దు చేయలేరు. పాఠశాలకు కాపీ కావాలంటే ముందుగా డేటాను ఎగుమతి చేయమని చెప్పండి.',
  'Delete school…': 'పాఠశాలను తొలగించండి…', 'Everything this school owns is erased for good. To confirm, type {word} below.': 'ఈ పాఠశాలకు చెందిన ప్రతిదీ శాశ్వతంగా తొలగించబడుతుంది. నిర్ధారించడానికి కింద {word} టైప్ చేయండి.', 'Type the school\'s address to confirm': 'నిర్ధారించడానికి పాఠశాల చిరునామా టైప్ చేయండి',

  // Records
  'Parents': 'తల్లిదండ్రులు', 'Country code': 'దేశ కోడ్', 'Phone number': 'ఫోన్ నంబర్', 'No approved parent link': 'ఆమోదించిన తల్లిదండ్రుల లింక్ లేదు',
  'No pending waivers. Clerks request waivers from the Fees page.': 'పెండింగ్ మాఫీలు లేవు. గుమస్తాలు ఫీజుల పేజీ నుండి మాఫీలు అభ్యర్థిస్తారు.', 'No {status} waivers. Clerks request waivers from the Fees page.': '{status} మాఫీలు లేవు. గుమస్తాలు ఫీజుల పేజీ నుండి మాఫీలు అభ్యర్థిస్తారు.',
  'Decision: {waiverNote}': 'నిర్ణయం: {waiverNote}', 'Approve waiver': 'మాఫీ ఆమోదించండి', 'Decline': 'తిరస్కరించండి', 'The note below is stored against every invoice.': 'కింది గమనిక ప్రతి ఇన్‌వాయిస్‌తో పాటు నిల్వ చేయబడుతుంది.', 'Note (required)': 'గమనిక (తప్పనిసరి)',
  'Issue certificates': 'సర్టిఫికెట్లు జారీ చేయండి', 'Not issued:': 'జారీ కానివి:', 'No certificates issued yet. Ask the school office to issue one.': 'ఇంకా సర్టిఫికెట్లు జారీ కాలేదు. పాఠశాల కార్యాలయాన్ని జారీ చేయమని అడగండి.',
  'Number': 'సంఖ్య', 'Type': 'రకం', 'Issued': 'జారీ చేసినది', 'View': 'చూడండి', 'PDF': 'PDF', 'Download PDF': 'PDF డౌన్‌లోడ్ చేయండి', 'Print': 'ప్రింట్ చేయండి', 'Principal': 'ప్రిన్సిపాల్',

  // Report card and results
  'No linked student yet. A clerk proposes the link and the principal or admin approves it.': 'ఇంకా లింక్ చేసిన విద్యార్థి లేరు. గుమస్తా లింక్‌ను ప్రతిపాదిస్తారు, ప్రిన్సిపాల్ లేదా అడ్మిన్ ఆమోదిస్తారు.',
  'Exam': 'పరీక్ష', 'Score': 'మార్కులు', 'Overall: {totalScore} / {totalMax}': 'మొత్తం: {totalScore} / {totalMax}', '{overallPercent}% · Grade {overallGrade}': '{overallPercent}% · గ్రేడ్ {overallGrade}',
  'No pending results. Teachers submit exam marks here for approval; students and parents see them once approved.': 'పెండింగ్ ఫలితాలు లేవు. ఉపాధ్యాయులు పరీక్ష మార్కులను ఆమోదం కోసం ఇక్కడ సమర్పిస్తారు; ఆమోదించిన తర్వాత విద్యార్థులు మరియు తల్లిదండ్రులు చూస్తారు.',
  'No {status} results. Teachers submit exam marks here for approval; students and parents see them once approved.': '{status} ఫలితాలు లేవు. ఉపాధ్యాయులు పరీక్ష మార్కులను ఆమోదం కోసం ఇక్కడ సమర్పిస్తారు; ఆమోదించిన తర్వాత విద్యార్థులు మరియు తల్లిదండ్రులు చూస్తారు.',
  'Teacher': 'ఉపాధ్యాయుడు', 'Marked': 'మార్కులు వేశారు', '{date} · out of {maxMarks}': '{date} · {maxMarks}కి', 'Send back': 'తిప్పి పంపండి',

  // Plan and data (school)
  'Your school data was downloaded': 'మీ పాఠశాల డేటా డౌన్‌లోడ్ అయింది', 'Your plan ends soon. Ask the platform administrator to renew it.': 'మీ ప్లాన్ త్వరలో ముగుస్తుంది. దాన్ని పునరుద్ధరించమని ప్లాట్‌ఫారమ్ అడ్మినిస్ట్రేటర్‌ను అడగండి.',
  'Your plan has ended. Renew it soon: new students cannot be added if it stays unpaid.': 'మీ ప్లాన్ ముగిసింది. త్వరగా పునరుద్ధరించండి: చెల్లించకపోతే కొత్త విద్యార్థులను చేర్చలేరు.',
  'Your plan has ended. New students cannot be added until it is renewed. Everything else keeps working.': 'మీ ప్లాన్ ముగిసింది. పునరుద్ధరించే వరకు కొత్త విద్యార్థులను చేర్చలేరు. మిగతా అంతా పనిచేస్తుంది.',
  'Plan and data': 'ప్లాన్ మరియు డేటా', 'What your plan allows, and a copy of your school’s records.': 'మీ ప్లాన్ ఏమి అనుమతిస్తుంది, మరియు మీ పాఠశాల రికార్డుల కాపీ.', 'Your plan': 'మీ ప్లాన్',
  'No plan has been set for this school, so there are no limits.': 'ఈ పాఠశాలకు ప్లాన్ సెట్ చేయలేదు, కాబట్టి పరిమితులు లేవు.', 'Price per month': 'నెలకు ధర', 'No end date': 'ముగింపు తేదీ లేదు',
  '{n} of {max} students': '{max}లో {n} విద్యార్థులు', '{n} students (no limit)': '{n} విద్యార్థులు (పరిమితి లేదు)', 'Students compared with the plan limit': 'ప్లాన్ పరిమితితో పోలిస్తే విద్యార్థులు', 'Export your school’s data': 'మీ పాఠశాల డేటాను ఎగుమతి చేయండి',
  'Downloads every record your school owns (people, classes, attendance, results, fees, announcements and more) as one file. It does not include passwords, private messages or uploaded files. You can make one export every few minutes.': 'మీ పాఠశాలకు చెందిన ప్రతి రికార్డును (వ్యక్తులు, తరగతులు, హాజరు, ఫలితాలు, ఫీజులు, ప్రకటనలు మరియు మరిన్ని) ఒకే ఫైల్‌గా డౌన్‌లోడ్ చేస్తుంది. దీనిలో పాస్‌వర్డ్‌లు, ప్రైవేట్ సందేశాలు లేదా అప్‌లోడ్ చేసిన ఫైళ్లు ఉండవు. కొన్ని నిమిషాలకు ఒకసారి ఎగుమతి చేయవచ్చు.',
  'Preparing…': 'సిద్ధమవుతోంది…', 'Download school data': 'పాఠశాల డేటా డౌన్‌లోడ్ చేయండి',

  // Settings
  'How you want to be notified': 'మీకు ఎలా తెలియజేయాలి', 'WhatsApp': 'వాట్సాప్', 'Phone with country code, e.g. +91 98765 43210': 'దేశ కోడ్‌తో ఫోన్, ఉదా: +91 98765 43210',
  'I agree to receive school messages on WhatsApp': 'వాట్సాప్‌లో పాఠశాల సందేశాలు అందుకోవడానికి నేను అంగీకరిస్తున్నాను', 'Add a phone number to receive WhatsApp messages.': 'వాట్సాప్ సందేశాలు అందుకోవడానికి ఫోన్ నంబర్ జోడించండి.',
  'Quiet hours saved': 'నిశ్శబ్ద సమయం సేవ్ అయింది', 'Quiet hours': 'నిశ్శబ్ద సమయం', 'Hold email and WhatsApp during quiet hours': 'నిశ్శబ్ద సమయంలో ఈమెయిల్ మరియు వాట్సాప్ ఆపండి', 'Until': 'వరకు', 'Your timezone': 'మీ సమయ మండలం',
  'Messages that arrive in this time are sent when it ends. Alerts inside the app still appear straight away, and urgent messages (such as an urgent announcement or a long-overdue fee) always come through.': 'ఈ సమయంలో వచ్చే సందేశాలు అది ముగిసినప్పుడు పంపబడతాయి. యాప్ లోపలి హెచ్చరికలు వెంటనే కనిపిస్తాయి, అత్యవసర సందేశాలు (అత్యవసర ప్రకటన లేదా చాలా కాలంగా గడువు దాటిన ఫీజు వంటివి) ఎల్లప్పుడూ వస్తాయి.',
  'The start and end times must be different.': 'ప్రారంభ మరియు ముగింపు సమయాలు వేర్వేరుగా ఉండాలి.', 'Refresh': 'రిఫ్రెష్ చేయండి', 'No email or WhatsApp messages yet.': 'ఇంకా ఈమెయిల్ లేదా వాట్సాప్ సందేశాలు లేవు.', 'When': 'ఎప్పుడు', 'Channel': 'మార్గం', 'Detail': 'వివరం',
  'Password changed': 'పాస్‌వర్డ్ మార్చబడింది', 'Change password': 'పాస్‌వర్డ్ మార్చండి', 'Current password': 'ప్రస్తుత పాస్‌వర్డ్', 'New password (8+ characters)': 'కొత్త పాస్‌వర్డ్ (8+ అక్షరాలు)',
  'Action': 'చర్య', 'Resource': 'వనరు', 'Bulk': 'బల్క్',

  // Timetable
  'Time': 'సమయం', 'Period {period}': 'పీరియడ్ {period}', 'Timetable saved': 'సమయ పట్టిక సేవ్ అయింది', 'You have unsaved changes. Switch class and lose them?': 'మీకు సేవ్ చేయని మార్పులు ఉన్నాయి. తరగతి మార్చి వాటిని పోగొట్టుకుంటారా?',
  'Add period': 'పీరియడ్ జోడించండి', 'Copy a day': 'ఒక రోజును కాపీ చేయండి', 'Copy a day…': 'ఒక రోజును కాపీ చేయండి…', 'Unsaved changes': 'సేవ్ చేయని మార్పులు', 'Leave without saving?': 'సేవ్ చేయకుండా వెళ్లాలా?', 'Day': 'రోజు', 'Period': 'పీరియడ్',
  'Start time': 'ప్రారంభ సమయం', 'to': 'నుండి', 'End time': 'ముగింపు సమయం', 'No teacher': 'ఉపాధ్యాయుడు లేరు', 'Also teaches on {value}: {value2}': '{value} న కూడా బోధిస్తారు: {value2}',
  'No periods yet. Use “Add period” to start this class’s week.': 'ఇంకా పీరియడ్‌లు లేవు. ఈ తరగతి వారాన్ని ప్రారంభించడానికి “పీరియడ్ జోడించండి” వాడండి.',
  'One teacher can take several classes. Teachers already booked at that day and time are greyed out, and their other classes that day are shown under the row.': 'ఒక ఉపాధ్యాయుడు అనేక తరగతులు తీసుకోవచ్చు. ఆ రోజు, సమయానికి ఇప్పటికే బుక్ అయిన ఉపాధ్యాయులు మసకగా కనిపిస్తారు, ఆ రోజు వారి ఇతర తరగతులు వరుస కింద చూపబడతాయి.',
  'Edit timetable': 'సమయ పట్టికను సవరించండి', 'Filter by class': 'తరగతి వారీగా వడపోయండి', 'You are not in any class yet, so there is no timetable to show.': 'మీరు ఇంకా ఏ తరగతిలోనూ లేరు, కాబట్టి చూపడానికి సమయ పట్టిక లేదు.', 'My teaching schedule': 'నా బోధన షెడ్యూల్',

  // Users
  'Details saved': 'వివరాలు సేవ్ అయ్యాయి', 'Full name': 'పూర్తి పేరు', 'Phone': 'ఫోన్', '(optional, with country code)': '(ఐచ్ఛికం, దేశ కోడ్‌తో)', 'Change role for {name}': '{name} పాత్రను మార్చండి', 'Currently': 'ప్రస్తుతం',
  '. Their menu and access change straight away.': '. వారి మెనూ మరియు ప్రాప్యత వెంటనే మారతాయి.', 'New role': 'కొత్త పాత్ర', 'This removes {value}.': 'ఇది {value}ను తొలగిస్తుంది.',
  'Give these sign-in details to {name}. This password is shown only once.': 'ఈ సైన్ ఇన్ వివరాలను {name}కు ఇవ్వండి. ఈ పాస్‌వర్డ్ ఒక్కసారి మాత్రమే చూపబడుతుంది.', 'They will be asked to choose a new password the first time they sign in.': 'మొదటిసారి సైన్ ఇన్ చేసేటప్పుడు కొత్త పాస్‌వర్డ్ ఎంచుకోమని అడుగుతారు.',
  'Add user': 'వినియోగదారును జోడించండి', 'Search name, email or phone': 'పేరు, ఈమెయిల్ లేదా ఫోన్ వెతకండి', 'Filter by role': 'పాత్ర వారీగా వడపోయండి', 'All roles': 'అన్ని పాత్రలు', 'Filter by status': 'స్థితి వారీగా వడపోయండి',
  'Active and deactivated': 'క్రియాశీలం మరియు నిష్క్రియం', 'No one matches.': 'ఎవరూ సరిపోలలేదు.', 'Hasn\'t set a password yet': 'ఇంకా పాస్‌వర్డ్ సెట్ చేయలేదు', 'Edit details': 'వివరాలను సవరించండి', 'Change role': 'పాత్రను మార్చండి', 'Deactivate': 'నిష్క్రియం చేయండి',

  // Voice
  'speaking': 'మాట్లాడుతున్నారు', 'My notes': 'నా నోట్స్', 'Write down what you want to remember from this call…': 'ఈ కాల్ నుండి మీరు గుర్తుంచుకోవాలనుకునేది రాయండి…', 'Mute': 'మ్యూట్ చేయండి', 'Remove from call': 'కాల్ నుండి తొలగించండి',
  'Connecting…': 'కనెక్ట్ అవుతోంది…', 'Listening only. Turn on the mic to talk.': 'వినడం మాత్రమే. మాట్లాడటానికి మైక్ ఆన్ చేయండి.', 'Microphone and camera need a secure (https) connection. You can still listen.': 'మైక్రోఫోన్ మరియు కెమెరాకు సురక్షిత (https) కనెక్షన్ కావాలి. మీరు ఇంకా వినవచ్చు.',
  'Voice channel created': 'వాయిస్ ఛానెల్ సృష్టించబడింది', 'Channel deleted': 'ఛానెల్ తొలగించబడింది', 'New voice channel, e.g. Study room 1': 'కొత్త వాయిస్ ఛానెల్, ఉదా: స్టడీ రూమ్ 1', 'No voice channels yet.': 'ఇంకా వాయిస్ ఛానెల్‌లు లేవు.', 'Confirm delete': 'తొలగింపును నిర్ధారించండి',
  'Calls are for up to {max} people. Your microphone and camera stay off until you turn them on.': 'కాల్‌లో గరిష్టంగా {max} మంది ఉండవచ్చు. మీరు ఆన్ చేసే వరకు మీ మైక్రోఫోన్ మరియు కెమెరా ఆఫ్‌లో ఉంటాయి.',
  'Showing the first {shown} of {total}. Use the search or filters to find the rest.': 'మొత్తం {total}లో మొదటి {shown} చూపబడ్డాయి. మిగతావి కనుగొనడానికి శోధన లేదా ఫిల్టర్‌లు వాడండి.',
  'Long lists': 'పొడవైన జాబితాలు',
  'The most rows that students, fees, admissions, certificates and leave requests load at once. A larger number shows more rows but makes those pages slower. When a list is cut off, a notice says so.': 'విద్యార్థులు, ఫీజులు, ప్రవేశాలు, సర్టిఫికెట్లు మరియు సెలవు అభ్యర్థనల జాబితాలు ఒకేసారి గరిష్టంగా ఎన్ని వరుసలు లోడ్ చేయాలి. పెద్ద సంఖ్య ఎక్కువ వరుసలు చూపుతుంది కానీ ఆ పేజీలను నెమ్మదిగా చేస్తుంది. జాబితా కత్తిరించబడితే ఒక నోటీసు చెబుతుంది.',
  'Rows per list': 'ఒక్కో జాబితాకు వరుసలు',
  'Enter a whole number from {min} to {max}.': '{min} నుండి {max} వరకు ఒక పూర్ణ సంఖ్యను నమోదు చేయండి.',
  'Hide the class list': 'తరగతుల జాబితా దాచండి',
  'Show the class list': 'తరగతుల జాబితా చూపండి',
}
export default te
