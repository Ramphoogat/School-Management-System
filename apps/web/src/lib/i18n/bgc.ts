/**
 * Haryanvi (हरियाणवी), written in Devanagari. It sits on top of the Hindi translations: the strings below are in Haryanvi
 * phrasing (सै for है, कोनी for नहीं, थम/थारा for आप/आपका, इब for अब, ...) and anything not listed here shows the Hindi text,
 * which Haryanvi speakers read easily. Keys are the English text used in the code.
 * These were written without a native-speaker review; have someone fluent check them.
 */
const bgc: Record<string, string> = {
  // Sign-in
  'Sign in to your workspace': 'अपणे काम की जगहा म्हैं साइन इन करो',
  'I am a': 'मैं सूं',
  'Hide password': 'पासवर्ड छुपाओ', 'Show password': 'पासवर्ड दिखाओ', 'Signing in…': 'साइन इन हो रह्या सै…', 'Sign in': 'साइन इन करो',
  'Choose your role first': 'पहलम अपणी भूमिका छांटो',
  'School not available': 'स्कूल उपलब्ध कोनी',
  'This school address is not in use, or the school is not active right now. Check the link you were given.': 'यो स्कूल का पता बरता कोनी जा रह्या, या स्कूल इब चालू कोनी। थमनैं जो लिंक दिया था वो देख लो।',
  'Go to the general sign-in': 'आम साइन-इन पै जाओ',

  // Shell
  'Set your status': 'अपणी हालत छांटो', 'You appear offline to others': 'दूसरां नैं थम ऑफ़लाइन दिखोगे',
  'Open menu': 'मेनू खोलो', 'Close menu': 'मेनू बंद करो', 'Search or jump to…': 'खोजो या कितै भी जाओ…',
  'You are offline. Changes will not save until you are back online.': 'थम ऑफ़लाइन सो। इंटरनेट आण ताईं बदलाव सहेजे कोनी जावैंगे।',
  'You are using a temporary password.': 'थम अस्थायी पासवर्ड बरत रह्या सो।', 'Change it now': 'इब बदल दो',
  'Skip to main content': 'मुख्य सामग्री पै जाओ', 'Create a new class': 'नई कक्षा बणाओ',
  'Create a channel in {name}': '{name} म्हैं चैनल बणाओ', 'Delete #{name}': '#{name} हटाओ', 'Delete #{name}? Its messages are deleted too.': '#{name} हटाणा सै? इसके संदेश भी हट जावैंगे।',

  // Home
  'Good morning': 'सुभ सवेर', 'Good afternoon': 'राम-राम', 'Good evening': 'सुभ सांझ',
  'Your classes, attendance and results in one place.': 'थारी कक्षा, हाजिरी अर नतीजे एक ठिकाणे पै।',
  'Follow your children’s attendance, results and school updates.': 'अपणे बालकां की हाजिरी, नतीजे अर स्कूल की खबर देखो।',
  'Open a class on the left to take attendance or post updates.': 'हाजिरी लेण या खबर घालण खातर बाएँ तैं कोए कक्षा खोलो।',
  'Admissions, fees and certificates waiting for you.': 'दाखिले, फीस अर प्रमाणपत्र थारी उडीक म्हैं सैं।',
  'Decisions waiting for you come first.': 'जिन फैसलां की उडीक सै, वे सबतैं पहलम।',
  'Approvals, people and school settings.': 'मंजूरी, लोग अर स्कूल की सेटिंग।',
  'Loading…': 'लोड हो रह्या सै…', 'You are all caught up.': 'थारा सारा काम निपट लिया।',
  '{n} thing(s) to look at': 'देखण खातर {n} बात', 'Nothing is waiting on you right now.': 'इब थारा कोए काम बाकी कोनी।',
  'Needs your attention': 'थारे ध्यान की जरूरत सै', 'Quick links': 'फटाफट लिंक', 'Notifications': 'सूचना', '{n} new': '{n} नई',
  'Mark all read': 'सारी पढ़ी हुई चिह्नित करो', 'Nothing new. Alerts show up here.': 'कुछ नया कोनी। अलर्ट याड़ै दिखैंगे।', 'Mark read': 'पढ़ी हुई चिह्नित करो',
  '{n} to action': '{n} पै कार्रवाई बाकी', '{n} unread': '{n} बिना पढ़ी', 'Attendance': 'हाजिरी', '{name}: attendance': '{name}: हाजिरी',
  'No attendance recorded yet.': 'इब ताईं कोए हाजिरी दर्ज कोनी।', 'Over the last {n} day(s)': 'पिछले {n} दिनां म्हैं',

  // Paging and appearance
  'Showing {from}–{to} of {total}': '{total} म्हैं तैं {from}–{to} दिखा रह्या सै',
  'Personalise your own dashboard. This is saved for you on this device.': 'अपणा डैशबोर्ड अपणे हिसाब तैं सजाओ। यो इसे डिवाइस पै थारे खातर सहेज्या जावै सै।',
  'Reset to default': 'डिफ़ॉल्ट पै ले चालो', 'Choose an image file': 'कोए फोटो की फाइल छांटो',
  'Image is too large to save. Try a smaller one.': 'फोटो सहेजण खातर घणी बड़ी सै। छोटी आजमाओ।',

  // Everyday buttons and words
  'Cancel': 'रद्द करो', 'Remove': 'हटाओ', 'Save': 'सहेजो', 'Edit': 'बदलो', 'Delete': 'हटाओ', 'Send': 'भेजो', 'Add': 'जोड़ो',
  'Approve': 'मंजूर करो', 'Reject': 'नामंजूर करो', 'Close': 'बंद करो', 'Select all': 'सारे छांटो', 'Print': 'छापो', 'View': 'देखो',
  'Post': 'घालो', 'Create': 'बणाओ', 'Back': 'पाछै', 'Copy': 'नकल करो', 'Done': 'होग्या', 'Manage': 'संभालो',
  'Search by name': 'नाम तैं खोजो', 'Search by name or email': 'नाम या ईमेल तैं खोजो', 'Reason (required)': 'कारण (जरूरी)', 'Note (optional)': 'टिप्पणी (मर्जी की)',
  'Save draft': 'मसौदा सहेजो', 'Send request': 'अर्जी भेजो', 'Submit request': 'अर्जी जमा करो', 'Download CSV': 'CSV डाउनलोड करो',

  // Messages and empty states
  'No messages yet. Ask a question or add details here.': 'इब ताईं कोए संदेश कोनी। याड़ै सवाल पूछो या ब्योरा जोड़ो।', 'Write a message…': 'संदेश लिखो…',
  'Message not sent': 'संदेश कोनी गया', 'No students found.': 'कोए विद्यार्थी कोनी मिल्या।', 'No documents yet.': 'इब ताईं कोए दस्तावेज कोनी।',
  'No announcements yet.': 'इब ताईं कोए घोषणा कोनी।', 'No homework yet.': 'इब ताईं कोए गृहकार्य कोनी।', 'No conversations yet.': 'इब ताईं कोए बातचीत कोनी।',
  'No members in this class yet.': 'इस कक्षा म्हैं इब ताईं कोए सदस्य कोनी।', 'No one matches.': 'कोए मेल कोनी खांदा।',
  'Choose which child this message is about': 'छांटो यो संदेश किस बालक बाबत सै',
  'Delete this message for both of you? This cannot be undone.': 'यो संदेश थम दोनूआं खातर हटाणा सै? इसनैं पलट कोनी सकते।',

  // Fees, leave, accounts
  'Payment received. A receipt is on its way.': 'भुगतान मिल गया। रसीद भेजी जा री सै।', 'Pay online': 'ऑनलाइन भरो', 'Pay at the school office': 'स्कूल दफ्तर म्हैं भरो',
  'The student and parents are told. This cannot be undone.': 'विद्यार्थी अर माता-पिता नैं बताया जावै सै। इसनैं पलट कोनी सकते।',
  'Leave request sent': 'छुट्टी की अर्जी भेज दी', 'Reason': 'कारण',
  'Password changed': 'पासवर्ड बदल गया', 'Change password': 'पासवर्ड बदलो', 'Current password': 'इब का पासवर्ड', 'New password (8+ characters)': 'नया पासवर्ड (8+ अक्षर)',
  'Details saved': 'ब्योरा सहेज लिया', 'Timetable saved': 'समय-सारणी सहेज ली', 'Hasn\'t set a password yet': 'इब ताईं पासवर्ड कोनी बणाया',
  'Saved': 'सहेज लिया', 'Exam created. Enter the marks below.': 'परीक्षा बण गई। नीच्चै नंबर भरो।', 'Announcement posted': 'घोषणा घाल दी', 'Class created': 'कक्षा बण गई',
  'Nothing matches. Try a class name or a page like “fees”.': 'कुछ कोनी मिल्या। कक्षा का नाम या “फीस” जिसा कोए पेज आजमाओ।',
  'Your school data was downloaded': 'थारे स्कूल का डेटा डाउनलोड हो लिया',
}
export default bgc
