/** Hindi, for the screens beyond sign-in and home. Keys are the English text used in the code. */
const hi: Record<string, string> = {
  // Words shown inside sentences
  'pending': 'लंबित', 'approved': 'स्वीकृत', 'rejected': 'अस्वीकृत', 'requested': 'अनुरोधित', 'submitted': 'जमा', 'open': 'खुली', 'reviewed': 'समीक्षित', 'dismissed': 'खारिज',

  // Shared parts
  'This picture needs at least {n}% dimming for text to stay readable.': 'पाठ पढ़ने योग्य रहे, इसके लिए इस चित्र को कम से कम {n}% धुँधला करना ज़रूरी है।',
  'Previous month': 'पिछला महीना', 'Next month': 'अगला महीना', 'Today': 'आज', 'today': 'आज',
  'Choose a date to see what happened that day.': 'उस दिन क्या हुआ, यह देखने के लिए कोई तारीख चुनें।',
  'Leave request': 'अवकाश अनुरोध', 'Note': 'टिप्पणी',
  'No messages from the school on this day.': 'इस दिन स्कूल की ओर से कोई संदेश नहीं है।', 'Homework': 'गृहकार्य',
  '{count} selected': '{count} चुने गए', 'Clear': 'हटाएँ',
  'Calculator': 'कैलकुलेटर', 'Click the calculator, then type numbers and + − * / Enter': 'कैलकुलेटर पर क्लिक करें, फिर संख्याएँ और + − * / Enter टाइप करें',
  'Send via': 'इसके माध्यम से भेजें', '(not set up yet)': '(अभी सेट नहीं है)',
  'WhatsApp only reaches people who opted in. If it fails, email is used instead.': 'व्हाट्सऐप केवल उन लोगों तक पहुँचता है जिन्होंने सहमति दी है। विफल होने पर ईमेल भेजा जाता है।',
  'Class teacher': 'कक्षा शिक्षक', 'Monitor': 'मॉनिटर', 'No class teacher': 'कोई कक्षा शिक्षक नहीं', 'No class monitor': 'कोई कक्षा मॉनिटर नहीं',
  'Teachers ({length})': 'शिक्षक ({length})', 'No teachers yet.': 'अभी कोई शिक्षक नहीं।', 'Students ({length})': 'छात्र ({length})', 'No students yet.': 'अभी कोई छात्र नहीं।',
  'Add to this class': 'इस कक्षा में जोड़ें', 'Select all shown': 'दिखाए गए सभी चुनें', 'Remove {name} from {name2}?': '{name} को {name2} से हटाएँ?',
  'They lose access to this class\'s channels, homework and timetable.': 'उनकी इस कक्षा के चैनलों, गृहकार्य और समय-सारणी तक पहुँच समाप्त हो जाएगी।',
  'Cancel': 'रद्द करें', 'Remove': 'हटाएँ', 'Teachers': 'शिक्षक', 'Students': 'छात्र',
  'Command bar': 'कमांड बार', 'Search pages, classes, people…': 'पृष्ठ, कक्षाएँ, लोग खोजें…',
  'Nothing matches. Try a class name or a page like “fees”.': 'कुछ नहीं मिला। कक्षा का नाम या “शुल्क” जैसा कोई पृष्ठ आज़माएँ।',
  'Appearance: theme, wallpaper, light / dark': 'रूप-रंग: थीम, वॉलपेपर, हल्का / गहरा', 'Sign out': 'साइन आउट',
  'Channel created': 'चैनल बन गया', 'Create channel': 'चैनल बनाएँ', 'in {name}': '{name} में', 'Icon': 'आइकन', 'Channel icon': 'चैनल का आइकन', 'Channel name': 'चैनल का नाम',
  'Accent colour': 'मुख्य रंग', 'Use the default': 'डिफ़ॉल्ट का उपयोग करें',
  'Why they need leave': 'उन्हें अवकाश क्यों चाहिए', 'Decision note': 'निर्णय की टिप्पणी', 'Approve': 'स्वीकृत करें', 'Reject': 'अस्वीकार करें',
  'No messages yet. Ask a question or add details here.': 'अभी कोई संदेश नहीं। यहाँ प्रश्न पूछें या विवरण जोड़ें।', 'Write a message…': 'संदेश लिखें…', 'Send': 'भेजें',
  '(you)': '(आप)', 'Loading members…': 'सदस्य लोड हो रहे हैं…', 'No monitor': 'कोई मॉनिटर नहीं', 'No members in this class yet.': 'इस कक्षा में अभी कोई सदस्य नहीं है।',
  'Photo for {name}': '{name} की फ़ोटो', 'Drag to position the face inside the frame, and use the slider to zoom.': 'चेहरे को फ़्रेम के भीतर लाने के लिए खींचें, और ज़ूम के लिए स्लाइडर उपयोग करें।',
  'Photo preview. Drag to move it.': 'फ़ोटो का पूर्वावलोकन। हिलाने के लिए खींचें।',
  'File shared': 'फ़ाइल साझा की गई', 'PDF, images, Word or text, up to 10 MB': 'PDF, चित्र, Word या टेक्स्ट, 10 MB तक', 'No files shared yet.': 'अभी कोई फ़ाइल साझा नहीं की गई है।',
  'Your school’s plan ends soon.': 'आपके स्कूल की योजना जल्द समाप्त होगी।', 'Your school’s plan has ended.': 'आपके स्कूल की योजना समाप्त हो गई है।',
  'Your school’s plan has ended, so new students cannot be added.': 'आपके स्कूल की योजना समाप्त हो गई है, इसलिए नए छात्र नहीं जोड़े जा सकते।', 'See the plan': 'योजना देखें',

  // Academic year and grades
  'From': 'से', 'To': 'तक', 'Add': 'जोड़ें', 'Academic years and terms': 'शैक्षणिक वर्ष और सत्र',
  'New exams join the term their date falls in, so report cards can be shown one term at a time.': 'नई परीक्षाएँ उस सत्र में जुड़ती हैं जिसमें उनकी तारीख पड़ती है, ताकि रिपोर्ट कार्ड एक-एक सत्र के हिसाब से दिखाए जा सकें।',
  'No academic year yet. Add the first one above.': 'अभी कोई शैक्षणिक वर्ष नहीं है। ऊपर पहला वर्ष जोड़ें।', 'Current': 'वर्तमान', 'Make current': 'वर्तमान बनाएँ', '{startDate} to {endDate}': '{startDate} से {endDate}',
  'Grade scale saved': 'ग्रेड स्केल सहेजा गया', 'Back to the standard scale': 'मानक स्केल पर लौट आए', 'Grade scale': 'ग्रेड स्केल', 'Standard': 'मानक',
  'A mark earns the grade of the highest band whose minimum it reaches. One band must start at 0. Changing the scale updates every report card.': 'किसी अंक को उस उच्चतम बैंड का ग्रेड मिलता है जिसका न्यूनतम अंक वह छू ले। एक बैंड 0 से शुरू होना चाहिए। स्केल बदलने से हर रिपोर्ट कार्ड बदल जाता है।',
  'Minimum percent': 'न्यूनतम प्रतिशत', '% is': '% है', 'Grade': 'ग्रेड', 'Remove band': 'बैंड हटाएँ', 'Add band': 'बैंड जोड़ें', 'Save scale': 'स्केल सहेजें', 'Use standard scale': 'मानक स्केल का उपयोग करें',
  'Academic year and grades': 'शैक्षणिक वर्ष और ग्रेड',

  // Admissions
  'Application added for approval': 'आवेदन स्वीकृति के लिए जोड़ा गया', 'Student name': 'छात्र का नाम', 'Student email (login)': 'छात्र का ईमेल (लॉगिन)', 'Parent name': 'अभिभावक का नाम',
  'Parent email (login)': 'अभिभावक का ईमेल (लॉगिन)', 'Parent phone (+91…)': 'अभिभावक का फ़ोन (+91…)', 'Parent agreed to WhatsApp messages': 'अभिभावक व्हाट्सऐप संदेशों के लिए सहमत हैं',
  'Add application': 'आवेदन जोड़ें', 'Import CSV': 'CSV आयात करें', 'Download template': 'टेम्पलेट डाउनलोड करें',
  'Columns: studentName, studentEmail, parentName, parentEmail, parentPhone, relationship, class, whatsappOptIn (yes/no)': 'कॉलम: studentName, studentEmail, parentName, parentEmail, parentPhone, relationship, class, whatsappOptIn (yes/no)',
  'Not processed:': 'संसाधित नहीं हुए:', 'Select all': 'सभी चुनें', 'Select row': 'पंक्ति चुनें', 'New accounts created': 'नए खाते बनाए गए',
  'Temporary passwords are shown only now and are not stored. Download or copy them and hand them out. Each person must change theirs after first sign-in.': 'अस्थायी पासवर्ड केवल अभी दिखाए जाते हैं और सहेजे नहीं जाते। उन्हें डाउनलोड या कॉपी करके बाँट दें। हर व्यक्ति को पहली बार साइन इन के बाद अपना पासवर्ड बदलना होगा।',
  'Name': 'नाम', 'Temporary password': 'अस्थायी पासवर्ड', 'Download CSV': 'CSV डाउनलोड करें',
  'No {status} applications. Add one above or import a CSV.': 'कोई {status} आवेदन नहीं। ऊपर एक जोड़ें या CSV आयात करें।', 'No {status} applications.': 'कोई {status} आवेदन नहीं।',

  // School overview
  'Attendance, last 14 days': 'उपस्थिति, पिछले 14 दिन', 'Percent present each day (days with no marks are blank)': 'प्रतिदिन उपस्थित प्रतिशत (जिन दिनों उपस्थिति दर्ज नहीं हुई वे खाली हैं)',
  'No attendance has been marked in the last 14 days.': 'पिछले 14 दिनों में कोई उपस्थिति दर्ज नहीं हुई।', 'Average result by subject': 'विषय अनुसार औसत परिणाम', 'Approved results only': 'केवल स्वीकृत परिणाम',
  'No approved results yet.': 'अभी कोई स्वीकृत परिणाम नहीं।', 'Students with low attendance': 'कम उपस्थिति वाले छात्र', 'Under 75% over the last 30 days (3 or more days recorded)': 'पिछले 30 दिनों में 75% से कम (3 या अधिक दिन दर्ज)',
  'No students are below 75%.': 'कोई छात्र 75% से नीचे नहीं है।', 'Present': 'उपस्थित', 'Days recorded': 'दर्ज दिन',
  'Looking for things that need a decision? Open the approvals center.': 'निर्णय की प्रतीक्षा वाली चीज़ें खोज रहे हैं? स्वीकृति केंद्र खोलें।',

  // Approvals
  '{succeeded} of {total} succeeded. Not processed:': '{total} में से {succeeded} सफल। संसाधित नहीं हुए:',
  'No {status} role requests. Requests submitted by clerks and teachers appear here for approval.': 'कोई {status} भूमिका अनुरोध नहीं। क्लर्क और शिक्षकों के भेजे अनुरोध स्वीकृति के लिए यहाँ दिखाई देंगे।',
  'User': 'उपयोगकर्ता', 'Requested by': 'अनुरोधकर्ता', 'Requested role': 'अनुरोधित भूमिका', 'Needs action': 'कार्रवाई ज़रूरी',

  // Branding
  'Saved': 'सहेजा गया', 'The logo must be a PNG or JPG picture': 'लोगो PNG या JPG चित्र होना चाहिए', 'The logo must be under 500 KB': 'लोगो 500 KB से छोटा होना चाहिए',
  'Logo updated': 'लोगो अपडेट हुआ', 'Logo removed': 'लोगो हटाया गया', 'How your school looks on the sign-in page and across the app.': 'साइन-इन पृष्ठ और पूरे ऐप में आपका स्कूल कैसा दिखता है।',
  'School name': 'स्कूल का नाम', 'Tagline': 'टैगलाइन', '(shown under the name on the sign-in page)': '(साइन-इन पृष्ठ पर नाम के नीचे दिखती है)', 'e.g. Learning together': 'जैसे: साथ मिलकर सीखें',
  'Logo': 'लोगो', 'School logo': 'स्कूल का लोगो', 'PNG or JPG, up to 500 KB. A square picture on a plain background works best.': 'PNG या JPG, 500 KB तक। सादी पृष्ठभूमि पर वर्गाकार चित्र सबसे अच्छा रहता है।',
  'Preview of your sign-in page': 'आपके साइन-इन पृष्ठ का पूर्वावलोकन',

  // Class channels
  'Announcement updated': 'घोषणा अपडेट हुई', 'Announcement deleted': 'घोषणा हटाई गई', 'Announcement posted': 'घोषणा प्रकाशित हुई', 'Title': 'शीर्षक', 'Write an announcement…': 'घोषणा लिखें…',
  'Mark as urgent': 'अत्यावश्यक चिह्नित करें', 'Post': 'प्रकाशित करें', 'No announcements yet.': 'अभी कोई घोषणा नहीं।', 'Message': 'संदेश',
  'People are not sent this again. It shows as edited.': 'लोगों को यह दोबारा नहीं भेजा जाता। यह “संपादित” दिखेगा।', 'Save': 'सहेजें', 'Edit': 'संपादित करें', 'Delete': 'हटाएँ',
  'No linked children yet.': 'अभी कोई जुड़ा हुआ बच्चा नहीं।', 'Export CSV': 'CSV निर्यात करें', 'No students are enrolled in this class yet.': 'इस कक्षा में अभी कोई छात्र नामांकित नहीं है।',
  'not yet saved': 'अभी सहेजा नहीं गया', 'Approved leave today': 'आज स्वीकृत अवकाश', 'Mark present': 'उपस्थित चिह्नित करें', 'Mark absent': 'अनुपस्थित चिह्नित करें', 'Mark late': 'देर से चिह्नित करें',
  'Submitted': 'जमा किया', 'Instructions': 'निर्देश', 'Assign to classes': 'कक्षाओं को सौंपें', 'Assign homework': 'गृहकार्य दें', 'No homework yet.': 'अभी कोई गृहकार्य नहीं।',
  'Due {dueDate}': 'देय {dueDate}', 'Submitted {value}': '{value} को जमा किया', 'Your answer': 'आपका उत्तर', 'Files': 'फ़ाइलें', 'Missing': 'जमा नहीं', 'Message not sent': 'संदेश नहीं भेजा गया',
  'No messages yet. Say hello to your class.': 'अभी कोई संदेश नहीं। अपनी कक्षा को नमस्ते कहें।', 'Message the class…': 'कक्षा को संदेश भेजें…', 'Members': 'सदस्य', 'This channel no longer exists.': 'यह चैनल अब मौजूद नहीं है।',
  'The {channel} feature is built in a later phase. This channel is where it will live.': '{channel} सुविधा बाद के चरण में बनेगी। यह चैनल उसी का स्थान होगा।',
  'Document published': 'दस्तावेज़ प्रकाशित हुआ', 'Forms, circulars and policies from the school office.': 'स्कूल कार्यालय के फ़ॉर्म, परिपत्र और नीतियाँ।', 'Title (optional)': 'शीर्षक (वैकल्पिक)', 'No documents yet.': 'अभी कोई दस्तावेज़ नहीं।',

  // Exams
  'Submitted for approval': 'स्वीकृति के लिए जमा किया गया', 'Sent back by the principal: {reason}': 'प्रधानाचार्य ने वापस भेजा: {reason}', 'Columns: email, score (use AB for absent)': 'कॉलम: email, score (अनुपस्थित के लिए AB लिखें)',
  'Score / {maxMarks}': 'अंक / {maxMarks}', 'Absent': 'अनुपस्थित', 'Save draft': 'मसौदा सहेजें', 'Save and submit for approval': 'सहेजें और स्वीकृति के लिए जमा करें',
  'A score is outside 0 to {maxMarks}.': 'कोई अंक 0 से {maxMarks} के बाहर है।', 'Exam created. Enter the marks below.': 'परीक्षा बन गई। नीचे अंक भरें।', 'Exam deleted': 'परीक्षा हटाई गई',
  'Exam name (e.g. Unit Test 1)': 'परीक्षा का नाम (जैसे यूनिट टेस्ट 1)', 'Subject': 'विषय', 'Maximum marks': 'अधिकतम अंक', 'Create exam': 'परीक्षा बनाएँ', 'Delete {name}?': '{name} हटाएँ?', 'Reason (required)': 'कारण (आवश्यक)',

  // Fees
  'Loading fees…': 'शुल्क लोड हो रहा है…', 'No fees for {name} yet.': '{name} के लिए अभी कोई शुल्क नहीं।', 'Fee structure for {name}': '{name} की शुल्क संरचना', '{length} fee(s)': '{length} शुल्क',
  'Fee': 'शुल्क', 'Amount': 'राशि', 'Due': 'देय', 'Details': 'विवरण', 'Waiver sent to the principal': 'माफ़ी का अनुरोध प्रधानाचार्य को भेजा गया', 'Payment received. A receipt is on its way.': 'भुगतान प्राप्त हुआ। रसीद भेजी जा रही है।',
  'Fee title (e.g. Term 1)': 'शुल्क का शीर्षक (जैसे सत्र 1)', 'Amount ₹': 'राशि ₹', 'Create invoices for class': 'कक्षा के लिए चालान बनाएँ',
  'Remind students and parents about fees due soon or overdue. Runs by itself every day; nothing is sent twice.': 'जल्द देय या बकाया शुल्क के बारे में छात्रों और अभिभावकों को याद दिलाएँ। यह हर दिन अपने-आप चलता है; कुछ भी दो बार नहीं भेजा जाता।',
  'All classes': 'सभी कक्षाएँ', 'All statuses': 'सभी स्थितियाँ', 'Unpaid': 'भुगतान बाकी', 'Overdue': 'अतिदेय', 'Paid': 'भुगतान हुआ', 'Waived': 'माफ़', 'Refunded': 'वापस किया गया',
  'Select all unpaid': 'भुगतान बाकी सभी चुनें', 'Waiver pending': 'माफ़ी लंबित', 'Waiver declined': 'माफ़ी अस्वीकृत', 'Refund': 'वापसी', 'Request waiver': 'माफ़ी का अनुरोध करें',
  'Pay online': 'ऑनलाइन भुगतान करें', 'Pay at the school office': 'स्कूल कार्यालय में भुगतान करें', 'Mark paid': 'भुगतान हुआ चिह्नित करें', 'Mark {size} invoice(s) paid?': '{size} चालान को भुगतान हुआ चिह्नित करें?',
  'Total {value}. Receipts go to students and parents.': 'कुल {value}। रसीदें छात्रों और अभिभावकों को जाती हैं।', 'Reference (optional)': 'संदर्भ (वैकल्पिक)',
  'The student and parents are told. This cannot be undone.': 'छात्र और अभिभावकों को बताया जाता है। इसे पूर्ववत नहीं किया जा सकता।',
  'Amount to refund in rupees. Leave empty to refund all {amount} that is left.': 'वापसी की राशि रुपये में। शेष सभी {amount} लौटाने के लिए खाली छोड़ें।',
  'Full amount': 'पूरी राशि', 'Request a fee waiver': 'शुल्क माफ़ी का अनुरोध', 'Send request': 'अनुरोध भेजें', 'Refund {amount}?': '{amount} वापस करें?', 'Refund {amount} (all that is left)?': '{amount} वापस करें (जो शेष है वह सब)?',
  '{student}: {title} ({amount}). The principal decides.': '{student}: {title} ({amount})। निर्णय प्रधानाचार्य लेंगे।',

  // ID cards
  'Back': 'वापस', 'Print {length} card(s)': '{length} कार्ड प्रिंट करें', 'Not generated:': 'नहीं बने:', 'Class:': 'कक्षा:', 'Select students, generate their cards, then print the sheet.': 'छात्र चुनें, उनके कार्ड बनाएँ, फिर शीट प्रिंट करें।',
  'Search by name or email': 'नाम या ईमेल से खोजें', 'No students found.': 'कोई छात्र नहीं मिला।', 'Photo': 'फ़ोटो',

  // Leave
  'Leave request sent': 'अवकाश अनुरोध भेजा गया', 'Reason': 'कारण', 'For': 'किसके लिए', 'Dates': 'तारीख़ें', 'Requesters are notified.': 'अनुरोधकर्ताओं को सूचित किया जाता है।',

  // Roles, links, classes
  'Request submitted for approval': 'अनुरोध स्वीकृति के लिए भेजा गया', 'Request a role change': 'भूमिका बदलने का अनुरोध', 'Select user…': 'उपयोगकर्ता चुनें…', 'Note (optional)': 'टिप्पणी (वैकल्पिक)',
  'Submit request': 'अनुरोध जमा करें', 'My requests': 'मेरे अनुरोध', 'You have not submitted any requests yet.': 'आपने अभी कोई अनुरोध जमा नहीं किया है।', 'Link proposed for approval': 'लिंक स्वीकृति के लिए प्रस्तावित',
  'Parent–student links': 'अभिभावक–छात्र लिंक', 'Parent…': 'अभिभावक…', 'Student…': 'छात्र…', 'Relationship': 'संबंध', 'Propose link': 'लिंक प्रस्तावित करें',
  'No links yet. A parent only sees a child’s data after an approved link.': 'अभी कोई लिंक नहीं। अभिभावक को बच्चे का डेटा तभी दिखता है जब लिंक स्वीकृत हो।', 'Revoke': 'वापस लें',
  'Class created': 'कक्षा बन गई', 'The classes you teach. Open one to see its students and choose the class monitor.': 'आप जिन कक्षाओं को पढ़ाते हैं। किसी को खोलकर उसके छात्र देखें और कक्षा मॉनिटर चुनें।',
  'e.g. Grade 9-B': 'जैसे: कक्षा 9-B', 'Create': 'बनाएँ', 'Channels': 'चैनल', 'Not assigned': 'नियुक्त नहीं',

  // Message reports
  'Conversations that someone reported. You can read only these, and each time you open one it is recorded in the audit log.': 'वे बातचीतें जिनकी किसी ने शिकायत की। आप केवल इन्हें पढ़ सकते हैं, और हर बार खोलने पर यह ऑडिट लॉग में दर्ज होता है।',
  'No {status} reports.': 'कोई {status} शिकायत नहीं।', 'Reported': 'शिकायत की गई', 'Between': 'के बीच', 'reported': 'शिकायत की गई', 'Open': 'खुला', 'Reported conversation': 'शिकायत की गई बातचीत', 'Their reason': 'उनका कारण',
  'You are reading a private conversation because it was reported. This is recorded.': 'आप एक निजी बातचीत पढ़ रहे हैं क्योंकि उसकी शिकायत की गई थी। यह दर्ज किया जाता है।', 'Deleted by the sender': 'भेजने वाले ने हटाया',
  'Note for the record (the person who reported sees it)': 'रिकॉर्ड के लिए टिप्पणी (शिकायत करने वाला इसे देखता है)', 'No action needed': 'कार्रवाई की ज़रूरत नहीं', 'Mark reviewed': 'समीक्षित चिह्नित करें',

  // Direct messages
  '{value} · tap to download': '{value} · डाउनलोड के लिए टैप करें', 'New message': 'नया संदेश', 'Choose who you want to write to.': 'चुनें कि आप किसे लिखना चाहते हैं।', 'Search by name': 'नाम से खोजें',
  'Reported. The school will look at it.': 'शिकायत दर्ज हुई। स्कूल इसे देखेगा।', 'Tell us what is wrong. The person is not told who reported.': 'बताइए क्या गलत है। उस व्यक्ति को नहीं बताया जाता कि शिकायत किसने की।', 'What happened?': 'क्या हुआ?',
  'Reporting lets the school\'s reviewer read this conversation (the principal, or the admin if the principal is one of the two people). Nothing else of yours is opened. While it is open, messages here can\'t be edited or deleted.': 'शिकायत करने पर स्कूल का समीक्षक यह बातचीत पढ़ सकता है (प्रधानाचार्य, या यदि प्रधानाचार्य इन दोनों में से एक हैं तो एडमिन)। आपका और कुछ नहीं खोला जाता। जब तक यह खुली है, यहाँ के संदेश संपादित या हटाए नहीं जा सकते।',
  'Choose which child this message is about': 'चुनें कि यह संदेश किस बच्चे के बारे में है', 'Delete this message for both of you? This cannot be undone.': 'यह संदेश आप दोनों के लिए हटाएँ? इसे पूर्ववत नहीं किया जा सकता।',
  'Unblocked': 'अनब्लॉक किया गया', 'Back to messages': 'संदेशों पर वापस', 'typing…': 'टाइप कर रहे हैं…', 'Conversation options': 'बातचीत के विकल्प', 'Report conversation': 'बातचीत की शिकायत करें',
  'This conversation has been reported and can be reviewed by the school. Messages in it can\'t be edited or deleted for now.': 'इस बातचीत की शिकायत हुई है और स्कूल इसकी समीक्षा कर सकता है। फ़िलहाल इसके संदेश संपादित या हटाए नहीं जा सकते।',
  'Load earlier messages': 'पुराने संदेश लोड करें', 'No messages yet. Say hello to {value}.': 'अभी कोई संदेश नहीं। {value} को नमस्ते कहें।', 'About': 'के बारे में', 'This message was deleted': 'यह संदेश हटा दिया गया',
  'Message options': 'संदेश के विकल्प', 'Under review': 'समीक्षा में', 'Report message': 'संदेश की शिकायत करें', '· edited': '· संपादित', 'Seen': 'देखा गया', 'Sent': 'भेजा गया', '{value} is typing…': '{value} टाइप कर रहे हैं…',
  'Uploading…': 'अपलोड हो रहा है…', 'Which child is this about': 'यह किस बच्चे के बारे में है', 'Attach a file': 'फ़ाइल जोड़ें', 'Attach a file (PDF, image, Word, text; up to 10 MB)': 'फ़ाइल जोड़ें (PDF, चित्र, Word, टेक्स्ट; 10 MB तक)',
  'You blocked {name}. Unblock to message again.': 'आपने {name} को ब्लॉक किया है। दोबारा संदेश भेजने के लिए अनब्लॉक करें।', 'Unblock': 'अनब्लॉक करें', 'You can no longer message this person. You can still read this conversation.': 'अब आप इस व्यक्ति को संदेश नहीं भेज सकते। आप यह बातचीत पढ़ सकते हैं।',
  'New': 'नया', 'No conversations yet.': 'अभी कोई बातचीत नहीं।', 'Start one': 'शुरू करें', 'Choose a conversation, or start a new one.': 'कोई बातचीत चुनें, या नई शुरू करें।',

  // Message wording (admin)
  'The wording of every message the school sends by email, WhatsApp and in the app. Change any of them here. The defaults stay available if you want to go back.': 'स्कूल द्वारा ईमेल, व्हाट्सऐप और ऐप में भेजे जाने वाले हर संदेश के शब्द। इनमें से किसी को भी यहाँ बदलें। वापस जाना चाहें तो डिफ़ॉल्ट शब्द उपलब्ध रहते हैं।',
  'Changed': 'बदला गया', 'Has urgent wording': 'अत्यावश्यक शब्दावली है', 'To: {audience}': 'प्राप्तकर्ता: {audience}', 'Saved. New messages use this wording.': 'सहेजा गया। नए संदेश इन शब्दों का उपयोग करेंगे।',
  'Go back to the default wording for this message?': 'इस संदेश के लिए डिफ़ॉल्ट शब्दों पर लौटें?', 'Back to the default': 'डिफ़ॉल्ट पर लौटें', 'Wording': 'शब्दावली', 'Used when:': 'कब उपयोग होता है:',
  'Click to add a detail that is filled in for each person:': 'हर व्यक्ति के लिए भरा जाने वाला विवरण जोड़ने के लिए क्लिक करें:', 'Not available here: {value}. Use only the details above.': 'यहाँ उपलब्ध नहीं: {value}। केवल ऊपर दिए विवरणों का उपयोग करें।',
  'Preview with example details': 'उदाहरण विवरण के साथ पूर्वावलोकन', '(no subject)': '(कोई विषय नहीं)', 'Close': 'बंद करें',

  // Platform (super admin)
  'Copied': 'कॉपी हुआ', 'Could not copy. Select it and copy by hand.': 'कॉपी नहीं हो सका। इसे चुनकर हाथ से कॉपी करें।',
  'Give these sign-in details to {name}. The password is shown only once.': 'ये साइन-इन विवरण {name} को दें। पासवर्ड केवल एक बार दिखाया जाता है।', 'Sign-in address': 'साइन-इन पता', 'Copy': 'कॉपी करें',
  'They choose their own password the first time they sign in.': 'पहली बार साइन इन करते समय वे अपना पासवर्ड खुद चुनते हैं।', 'Done': 'हो गया', 'Add a school': 'स्कूल जोड़ें',
  'This creates the school and its first admin, who then sets everything else up.': 'यह स्कूल और उसका पहला एडमिन बनाता है, जो फिर बाकी सब कुछ सेट करता है।', 'Address': 'पता', '(its own sign-in link)': '(उसका अपना साइन-इन लिंक)', '(optional)': '(वैकल्पिक)',
  'First admin\'s name': 'पहले एडमिन का नाम', 'First admin\'s email': 'पहले एडमिन का ईमेल', 'Changing it changes the school\'s sign-in link. Tell them if you do.': 'इसे बदलने से स्कूल का साइन-इन लिंक बदल जाता है। बदलें तो उन्हें बता दें।',
  'Admins': 'एडमिन', 'Deactivated': 'निष्क्रिय', 'Reset password': 'पासवर्ड रीसेट करें', 'No admins yet.': 'अभी कोई एडमिन नहीं।', 'Add another admin': 'एक और एडमिन जोड़ें', 'Add admin': 'एडमिन जोड़ें', 'Add school': 'स्कूल जोड़ें',
  'No schools yet. Add the first one.': 'अभी कोई स्कूल नहीं। पहला जोड़ें।', 'Active': 'सक्रिय', 'Suspended': 'निलंबित', '{people} people · {students} students · {teachers} teachers': '{people} लोग · {students} छात्र · {teachers} शिक्षक',
  'Manage': 'प्रबंधित करें', 'Sign-in page': 'साइन-इन पृष्ठ', 'Suspend': 'निलंबित करें', 'Reactivate': 'फिर से चालू करें', 'Suspend {name}?': '{name} को निलंबित करें?',
  'Everyone at this school is signed out straight away and cannot sign in until you reactivate it. Nothing is deleted.': 'इस स्कूल के सभी लोग तुरंत साइन आउट हो जाते हैं और आपके फिर से चालू करने तक साइन इन नहीं कर सकते। कुछ भी हटाया नहीं जाता।',
  'Plans': 'योजनाएँ', 'A plan sets how many students a school can have and what it pays each month. Give a plan to a school from its Manage panel. Schools with no plan have no limit.': 'योजना तय करती है कि स्कूल में कितने छात्र हो सकते हैं और वह हर महीने कितना भुगतान करता है। योजना किसी स्कूल को उसके “प्रबंधित करें” पैनल से दें। बिना योजना वाले स्कूलों की कोई सीमा नहीं।',
  '(not offered)': '(उपलब्ध नहीं)', '{value} / month': '{value} / माह', 'Plan name': 'योजना का नाम', 'Student limit (0 = unlimited)': 'छात्र सीमा (0 = असीमित)', 'Price per month (₹)': 'प्रति माह कीमत (₹)', 'Add plan': 'योजना जोड़ें',
  'Edit plan': 'योजना संपादित करें', 'Changes apply to every school on this plan straight away.': 'बदलाव इस योजना वाले हर स्कूल पर तुरंत लागू होते हैं।', 'Plan saved': 'योजना सहेजी गई', 'Loading plan…': 'योजना लोड हो रही है…',
  'Plan and billing': 'योजना और बिलिंग', 'students': 'छात्र', 'Plan': 'योजना', 'No plan (no limits)': 'कोई योजना नहीं (कोई सीमा नहीं)', 'Paid up to': 'भुगतान की गई अवधि तक', 'Record a payment received': 'प्राप्त भुगतान दर्ज करें',
  'It pays for the months after the school is currently paid up to, or from today if that has passed.': 'यह स्कूल के वर्तमान भुगतान की अंतिम तारीख के बाद के महीनों का भुगतान करता है, या यदि वह बीत चुकी हो तो आज से।',
  'Amount (₹)': 'राशि (₹)', 'Months': 'महीने', 'Method': 'तरीका', 'Reference': 'संदर्भ', 'Transaction id': 'लेन-देन आईडी', 'Record payment': 'भुगतान दर्ज करें', 'Delete this school': 'यह स्कूल हटाएँ',
  'Deleting is permanent, so a school has to be suspended first. Suspend it from the schools list, then come back here.': 'हटाना स्थायी है, इसलिए स्कूल को पहले निलंबित करना ज़रूरी है। उसे स्कूलों की सूची से निलंबित करें, फिर यहाँ लौटें।',
  'Permanently removes the school and everything in it: people, classes, records, messages and files. This cannot be undone. Ask the school to export its data first if it needs a copy.': 'स्कूल और उसमें मौजूद सब कुछ स्थायी रूप से हटा देता है: लोग, कक्षाएँ, रिकॉर्ड, संदेश और फ़ाइलें। इसे पूर्ववत नहीं किया जा सकता। यदि स्कूल को प्रति चाहिए तो पहले उससे डेटा निर्यात करने को कहें।',
  'Delete school…': 'स्कूल हटाएँ…', 'Everything this school owns is erased for good. To confirm, type {word} below.': 'इस स्कूल का सब कुछ हमेशा के लिए मिट जाएगा। पुष्टि के लिए नीचे {word} टाइप करें।', 'Type the school\'s address to confirm': 'पुष्टि के लिए स्कूल का पता टाइप करें',

  // Records
  'Parents': 'अभिभावक', 'Country code': 'देश कोड', 'Phone number': 'फ़ोन नंबर', 'No approved parent link': 'कोई स्वीकृत अभिभावक लिंक नहीं',
  'No pending waivers. Clerks request waivers from the Fees page.': 'कोई लंबित माफ़ी नहीं। क्लर्क शुल्क पृष्ठ से माफ़ी का अनुरोध करते हैं।', 'No {status} waivers. Clerks request waivers from the Fees page.': 'कोई {status} माफ़ी नहीं। क्लर्क शुल्क पृष्ठ से माफ़ी का अनुरोध करते हैं।',
  'Decision: {waiverNote}': 'निर्णय: {waiverNote}', 'Approve waiver': 'माफ़ी स्वीकृत करें', 'Decline': 'अस्वीकार करें', 'The note below is stored against every invoice.': 'नीचे की टिप्पणी हर चालान के साथ सहेजी जाती है।', 'Note (required)': 'टिप्पणी (आवश्यक)',
  'Issue certificates': 'प्रमाणपत्र जारी करें', 'Not issued:': 'जारी नहीं हुए:', 'No certificates issued yet. Ask the school office to issue one.': 'अभी कोई प्रमाणपत्र जारी नहीं हुआ। स्कूल कार्यालय से जारी करने को कहें।',
  'Number': 'संख्या', 'Type': 'प्रकार', 'Issued': 'जारी', 'View': 'देखें', 'PDF': 'PDF', 'Download PDF': 'PDF डाउनलोड करें', 'Print': 'प्रिंट करें', 'Principal': 'प्रधानाचार्य',

  // Report card and results
  'No linked student yet. A clerk proposes the link and the principal or admin approves it.': 'अभी कोई जुड़ा छात्र नहीं। लिंक क्लर्क प्रस्तावित करता है और प्रधानाचार्य या एडमिन स्वीकृत करता है।',
  'Exam': 'परीक्षा', 'Score': 'अंक', 'Overall: {totalScore} / {totalMax}': 'कुल: {totalScore} / {totalMax}', '{overallPercent}% · Grade {overallGrade}': '{overallPercent}% · ग्रेड {overallGrade}',
  'No pending results. Teachers submit exam marks here for approval; students and parents see them once approved.': 'कोई लंबित परिणाम नहीं। शिक्षक परीक्षा के अंक स्वीकृति के लिए यहाँ जमा करते हैं; स्वीकृत होने पर छात्र और अभिभावक उन्हें देखते हैं।',
  'No {status} results. Teachers submit exam marks here for approval; students and parents see them once approved.': 'कोई {status} परिणाम नहीं। शिक्षक परीक्षा के अंक स्वीकृति के लिए यहाँ जमा करते हैं; स्वीकृत होने पर छात्र और अभिभावक उन्हें देखते हैं।',
  'Teacher': 'शिक्षक', 'Marked': 'अंकित', '{date} · out of {maxMarks}': '{date} · कुल {maxMarks} में से', 'Send back': 'वापस भेजें',

  // Plan and data (school)
  'Your school data was downloaded': 'आपके स्कूल का डेटा डाउनलोड हो गया', 'Your plan ends soon. Ask the platform administrator to renew it.': 'आपकी योजना जल्द समाप्त होगी। प्लेटफ़ॉर्म प्रशासक से इसे नवीनीकृत करने को कहें।',
  'Your plan has ended. Renew it soon: new students cannot be added if it stays unpaid.': 'आपकी योजना समाप्त हो गई है। जल्द नवीनीकरण करें: भुगतान न होने पर नए छात्र नहीं जोड़े जा सकेंगे।',
  'Your plan has ended. New students cannot be added until it is renewed. Everything else keeps working.': 'आपकी योजना समाप्त हो गई है। नवीनीकरण तक नए छात्र नहीं जोड़े जा सकते। बाकी सब कुछ चलता रहेगा।',
  'Plan and data': 'योजना और डेटा', 'What your plan allows, and a copy of your school’s records.': 'आपकी योजना क्या अनुमति देती है, और आपके स्कूल के रिकॉर्ड की एक प्रति।', 'Your plan': 'आपकी योजना',
  'No plan has been set for this school, so there are no limits.': 'इस स्कूल के लिए कोई योजना तय नहीं है, इसलिए कोई सीमा नहीं।', 'Price per month': 'प्रति माह कीमत', 'No end date': 'कोई समाप्ति तिथि नहीं',
  '{n} of {max} students': '{max} में से {n} छात्र', '{n} students (no limit)': '{n} छात्र (कोई सीमा नहीं)', 'Students compared with the plan limit': 'योजना की सीमा के मुकाबले छात्र', 'Export your school’s data': 'अपने स्कूल का डेटा निर्यात करें',
  'Downloads every record your school owns (people, classes, attendance, results, fees, announcements and more) as one file. It does not include passwords, private messages or uploaded files. You can make one export every few minutes.': 'आपके स्कूल के हर रिकॉर्ड (लोग, कक्षाएँ, उपस्थिति, परिणाम, शुल्क, घोषणाएँ और बहुत कुछ) को एक फ़ाइल में डाउनलोड करता है। इसमें पासवर्ड, निजी संदेश या अपलोड की गई फ़ाइलें शामिल नहीं हैं। आप कुछ-कुछ मिनट में एक बार निर्यात कर सकते हैं।',
  'Preparing…': 'तैयार हो रहा है…', 'Download school data': 'स्कूल का डेटा डाउनलोड करें',

  // Settings
  'How you want to be notified': 'आप कैसे सूचित होना चाहते हैं', 'WhatsApp': 'व्हाट्सऐप', 'Phone with country code, e.g. +91 98765 43210': 'देश कोड सहित फ़ोन, जैसे +91 98765 43210',
  'I agree to receive school messages on WhatsApp': 'मैं व्हाट्सऐप पर स्कूल के संदेश पाने के लिए सहमत हूँ', 'Add a phone number to receive WhatsApp messages.': 'व्हाट्सऐप संदेश पाने के लिए फ़ोन नंबर जोड़ें।',
  'Quiet hours saved': 'शांत समय सहेजा गया', 'Quiet hours': 'शांत समय', 'Hold email and WhatsApp during quiet hours': 'शांत समय में ईमेल और व्हाट्सऐप रोक रखें', 'Until': 'तक', 'Your timezone': 'आपका समय क्षेत्र',
  'Messages that arrive in this time are sent when it ends. Alerts inside the app still appear straight away, and urgent messages (such as an urgent announcement or a long-overdue fee) always come through.': 'इस समय में आने वाले संदेश उसके खत्म होने पर भेजे जाते हैं। ऐप के अंदर के अलर्ट तुरंत दिखते रहते हैं, और अत्यावश्यक संदेश (जैसे अत्यावश्यक घोषणा या बहुत पुराना बकाया शुल्क) हमेशा पहुँचते हैं।',
  'The start and end times must be different.': 'शुरू और समाप्त होने का समय अलग-अलग होना चाहिए।', 'Refresh': 'ताज़ा करें', 'No email or WhatsApp messages yet.': 'अभी कोई ईमेल या व्हाट्सऐप संदेश नहीं।', 'When': 'कब', 'Channel': 'माध्यम', 'Detail': 'ब्योरा',
  'Password changed': 'पासवर्ड बदल गया', 'Change password': 'पासवर्ड बदलें', 'Current password': 'वर्तमान पासवर्ड', 'New password (8+ characters)': 'नया पासवर्ड (8+ अक्षर)',
  'Action': 'कार्रवाई', 'Resource': 'संसाधन', 'Bulk': 'थोक',

  // Timetable
  'Time': 'समय', 'Period {period}': 'कालांश {period}', 'Timetable saved': 'समय-सारणी सहेजी गई', 'You have unsaved changes. Switch class and lose them?': 'आपके बदलाव सहेजे नहीं गए हैं। कक्षा बदलें और उन्हें खो दें?',
  'Add period': 'कालांश जोड़ें', 'Copy a day': 'एक दिन कॉपी करें', 'Copy a day…': 'एक दिन कॉपी करें…', 'Unsaved changes': 'बिना सहेजे बदलाव', 'Leave without saving?': 'बिना सहेजे छोड़ें?', 'Day': 'दिन', 'Period': 'कालांश',
  'Start time': 'शुरू का समय', 'to': 'से', 'End time': 'समाप्ति का समय', 'No teacher': 'कोई शिक्षक नहीं', 'Also teaches on {value}: {value2}': '{value} को भी पढ़ाते हैं: {value2}',
  'No periods yet. Use “Add period” to start this class’s week.': 'अभी कोई कालांश नहीं। इस कक्षा का सप्ताह शुरू करने के लिए “कालांश जोड़ें” का उपयोग करें।',
  'One teacher can take several classes. Teachers already booked at that day and time are greyed out, and their other classes that day are shown under the row.': 'एक शिक्षक कई कक्षाएँ ले सकता है। उस दिन और समय पर पहले से बुक शिक्षक धुँधले दिखते हैं, और उनकी उस दिन की अन्य कक्षाएँ पंक्ति के नीचे दिखाई जाती हैं।',
  'Edit timetable': 'समय-सारणी संपादित करें', 'Filter by class': 'कक्षा के अनुसार छाँटें', 'You are not in any class yet, so there is no timetable to show.': 'आप अभी किसी कक्षा में नहीं हैं, इसलिए दिखाने के लिए कोई समय-सारणी नहीं।', 'My teaching schedule': 'मेरा शिक्षण कार्यक्रम',

  // Users
  'Details saved': 'विवरण सहेजे गए', 'Full name': 'पूरा नाम', 'Phone': 'फ़ोन', '(optional, with country code)': '(वैकल्पिक, देश कोड सहित)', 'Change role for {name}': '{name} की भूमिका बदलें', 'Currently': 'वर्तमान में',
  '. Their menu and access change straight away.': '। उनका मेनू और पहुँच तुरंत बदल जाती है।', 'New role': 'नई भूमिका', 'This removes {value}.': 'इससे {value} हट जाता है।',
  'Give these sign-in details to {name}. This password is shown only once.': 'ये साइन-इन विवरण {name} को दें। यह पासवर्ड केवल एक बार दिखाया जाता है।', 'They will be asked to choose a new password the first time they sign in.': 'पहली बार साइन इन करते समय उनसे नया पासवर्ड चुनने को कहा जाएगा।',
  'Add user': 'उपयोगकर्ता जोड़ें', 'Search name, email or phone': 'नाम, ईमेल या फ़ोन खोजें', 'Filter by role': 'भूमिका के अनुसार छाँटें', 'All roles': 'सभी भूमिकाएँ', 'Filter by status': 'स्थिति के अनुसार छाँटें',
  'Active and deactivated': 'सक्रिय और निष्क्रिय', 'No one matches.': 'कोई मेल नहीं खाता।', 'Hasn\'t set a password yet': 'अभी पासवर्ड नहीं बनाया', 'Edit details': 'विवरण संपादित करें', 'Change role': 'भूमिका बदलें', 'Deactivate': 'निष्क्रिय करें',

  // Voice
  'speaking': 'बोल रहे हैं', 'My notes': 'मेरे नोट्स', 'Write down what you want to remember from this call…': 'इस कॉल से जो याद रखना चाहते हैं उसे लिखें…', 'Mute': 'म्यूट करें', 'Remove from call': 'कॉल से हटाएँ',
  'Connecting…': 'जुड़ रहा है…', 'Listening only. Turn on the mic to talk.': 'केवल सुन रहे हैं। बोलने के लिए माइक चालू करें।', 'Microphone and camera need a secure (https) connection. You can still listen.': 'माइक्रोफ़ोन और कैमरे के लिए सुरक्षित (https) कनेक्शन चाहिए। आप फिर भी सुन सकते हैं।',
  'Voice channel created': 'वॉइस चैनल बन गया', 'Channel deleted': 'चैनल हटाया गया', 'New voice channel, e.g. Study room 1': 'नया वॉइस चैनल, जैसे स्टडी रूम 1', 'No voice channels yet.': 'अभी कोई वॉइस चैनल नहीं।', 'Confirm delete': 'हटाने की पुष्टि करें',
  'Calls are for up to {max} people. Your microphone and camera stay off until you turn them on.': 'कॉल में अधिकतम {max} लोग हो सकते हैं। आपका माइक्रोफ़ोन और कैमरा तब तक बंद रहते हैं जब तक आप उन्हें चालू न करें।',
  'Showing the first {shown} of {total}. Use the search or filters to find the rest.': 'पहले {shown} दिखाए गए, कुल {total}। बाकी खोजने के लिए खोज या फ़िल्टर का उपयोग करें।',
  'Long lists': 'लंबी सूचियाँ',
  'The most rows that students, fees, admissions, certificates and leave requests load at once. A larger number shows more rows but makes those pages slower. When a list is cut off, a notice says so.': 'छात्र, शुल्क, प्रवेश, प्रमाणपत्र और अवकाश अनुरोधों की सूचियों में एक बार में अधिकतम कितनी पंक्तियाँ लोड हों। बड़ी संख्या से ज़्यादा पंक्तियाँ दिखती हैं पर वे पृष्ठ धीमे हो जाते हैं। सूची कट जाने पर एक सूचना बताती है।',
  'Rows per list': 'प्रति सूची पंक्तियाँ',
  'Enter a whole number from {min} to {max}.': '{min} से {max} तक की कोई पूर्ण संख्या लिखें।',
}
export default hi
