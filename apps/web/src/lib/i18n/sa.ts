/**
 * Sanskrit (संस्कृतम्), in Devanagari. It sits on top of the Hindi translations: the strings below are in Sanskrit, and anything
 * not listed here shows the Hindi text, which is also written in Devanagari. Keys are the English text used in the code.
 * Written without a Sanskrit scholar's review; have someone fluent check it.
 */
const sa: Record<string, string> = {
  // Sign-in
  'School Platform': 'विद्यालय-मञ्चः', 'Sign in to your workspace': 'स्वकार्यक्षेत्रे प्रविशत', 'I am a': 'अहम् अस्मि',
  'Email': 'विद्युत्पत्रम्', 'Password': 'गूढशब्दः', 'Hide password': 'गूढशब्दं गोपयत', 'Show password': 'गूढशब्दं दर्शयत',
  'Signing in…': 'प्रवेशः क्रियते…', 'Sign in': 'प्रविशत', 'Choose your role first': 'प्रथमं स्वभूमिकां चिनुत',
  'student': 'छात्रः', 'parent': 'अभिभावकः', 'teacher': 'शिक्षकः', 'clerk': 'लिपिकः', 'principal': 'प्रधानाचार्यः', 'admin': 'प्रबन्धकः',
  'Language': 'भाषा', 'Appearance': 'रूपम्', 'School not available': 'विद्यालयः अनुपलब्धः',
  'This school address is not in use, or the school is not active right now. Check the link you were given.': 'अयं विद्यालयस्य सङ्केतः प्रयोगे नास्ति, अथवा विद्यालयः सम्प्रति सक्रियः नास्ति। दत्तं सम्पर्कसूत्रं परीक्षत।',
  'Go to the general sign-in': 'सामान्यप्रवेशं गच्छत',

  // Menu
  'Schools': 'विद्यालयाः', 'Role approvals': 'भूमिका-अनुमोदनानि', 'Messages': 'सन्देशाः', 'School branding': 'विद्यालयचिह्नम्',
  'Message templates': 'सन्देशाकृतयः', 'Message reports': 'सन्देशवृत्तान्ताः', 'Timetable': 'समयसारणी', 'Approvals center': 'अनुमोदनकेन्द्रम्',
  'School overview': 'विद्यालयावलोकनम्', 'Leave': 'अवकाशः', 'Admissions': 'प्रवेशाः', 'Students': 'छात्राः', 'Fees': 'शुल्कम्',
  'Fee waivers': 'शुल्कमोचनानि', 'Certificates': 'प्रमाणपत्राणि', 'ID cards': 'परिचयपत्राणि', 'Academic year': 'शैक्षणिकं वर्षम्',
  'Documents': 'दस्तावेजाः', 'Result approvals': 'परिणाम-अनुमोदनानि', 'Report card': 'प्रगतिपत्रम्', 'Request role': 'भूमिकां याचत',
  'Parent links': 'अभिभावकसम्बन्धाः', 'Classes': 'कक्षाः', 'Users': 'उपयोक्तारः', 'Delivery log': 'प्रेषणलेखः',
  'Notification settings': 'सूचनासंयोजनानि', 'Audit log': 'परीक्षणलेखः', 'Plan and data': 'योजना दत्तांशश्च',

  // Shell
  'Workspace': 'कार्यक्षेत्रम्', 'Home': 'मुखपृष्ठम्', 'Your status': 'भवतः स्थितिः', 'Set your status': 'स्वस्थितिं चिनुत',
  'Online': 'सम्बद्धः', 'Invisible': 'अदृश्यः', 'You appear offline to others': 'अन्येभ्यः भवान् असम्बद्धः दृश्यते',
  'Log out': 'निर्गच्छत', 'Open menu': 'सूचीम् उद्घाटयत', 'Close menu': 'सूचीं पिधत्त', 'Search or jump to…': 'अन्विष्यत गच्छत वा…',
  'You are offline. Changes will not save until you are back online.': 'भवान् असम्बद्धः अस्ति। सम्बन्धं यावत् परिवर्तनानि न रक्ष्यन्ते।',
  'You are using a temporary password.': 'भवान् तात्कालिकं गूढशब्दं प्रयुङ्क्ते।', 'Change it now': 'इदानीं परिवर्तयत',
  'Skip to main content': 'मुख्यविषयं गच्छत', 'Main menu': 'मुख्यसूची', 'Create a new class': 'नूतनां कक्षां रचयत',
  'Create a channel in {name}': '{name} मध्ये वाहिनीं रचयत', 'Delete #{name}': '#{name} लोपयत', 'Delete #{name}? Its messages are deleted too.': '#{name} लोपयेत्? तस्य सन्देशाः अपि लुप्यन्ते।',

  // Home
  'Good morning': 'सुप्रभातम्', 'Good afternoon': 'शुभ मध्याह्नः', 'Good evening': 'शुभ सायंकालः',
  'Your classes, attendance and results in one place.': 'भवतः कक्षाः, उपस्थितिः, परिणामाश्च एकस्मिन् स्थले।',
  'Follow your children’s attendance, results and school updates.': 'स्वबालानाम् उपस्थितिं परिणामान् विद्यालयसूचनाश्च पश्यत।',
  'Open a class on the left to take attendance or post updates.': 'उपस्थितिग्रहणाय सूचनाप्रेषणाय वा वामतः कक्षाम् उद्घाटयत।',
  'Admissions, fees and certificates waiting for you.': 'प्रवेशाः शुल्कं प्रमाणपत्राणि च भवतः प्रतीक्षन्ते।',
  'Decisions waiting for you come first.': 'भवतः निर्णयं प्रतीक्षमाणानि कार्याणि प्रथमम्।',
  'Approvals, people and school settings.': 'अनुमोदनानि, जनाः, विद्यालयसंयोजनानि च।',
  'Loading…': 'आरोप्यते…', 'You are all caught up.': 'भवतः सर्वं कार्यं समाप्तम्।', '{n} thing(s) to look at': 'द्रष्टव्यानि {n}',
  'Nothing is waiting on you right now.': 'सम्प्रति भवतः किमपि कार्यं शेषं नास्ति।', 'Needs your attention': 'भवतः अवधानम् अपेक्षते',
  'Quick links': 'शीघ्रसम्पर्कसूत्राणि', 'Notifications': 'सूचनाः', '{n} new': '{n} नूतनानि', 'Mark all read': 'सर्वं पठितं चिह्नयत',
  'Nothing new. Alerts show up here.': 'नूतनं नास्ति। सूचनाः अत्र दृश्यन्ते।', 'Urgent': 'अत्यावश्यकम्', 'Mark read': 'पठितं चिह्नयत',
  '{n} to action': '{n} कार्यार्थम्', '{n} unread': '{n} अपठितानि', 'Attendance': 'उपस्थितिः', '{name}: attendance': '{name}: उपस्थितिः',
  'No attendance recorded yet.': 'उपस्थितिः अद्यावधि न लिखिता।', 'Over the last {n} day(s)': 'गतेषु {n} दिनेषु',

  // Paging and appearance
  'Showing {from}–{to} of {total}': '{total} मध्ये {from}–{to} दर्श्यन्ते', 'Rows': 'पङ्क्तयः', 'Pagination': 'पृष्ठसङ्ख्या',
  'First page': 'प्रथमं पृष्ठम्', 'Previous page': 'पूर्वं पृष्ठम्', 'Next page': 'अग्रिमं पृष्ठम्', 'Last page': 'अन्तिमं पृष्ठम्',
  'Personalise your own dashboard. This is saved for you on this device.': 'स्वस्य फलकं स्वेच्छया अलङ्कुरुत। एतत् अस्मिन् उपकरणे रक्ष्यते।',
  'Colour theme': 'वर्णविषयः', 'Wallpaper': 'पृष्ठभूमिः', 'None': 'नास्ति', 'Upload': 'आरोपयत', 'Light': 'प्रकाशः', 'Dark': 'अन्धकारः',
  'System': 'व्यवस्था', 'Reset to default': 'मूलस्थितिं प्रत्यानयत',

  // Everyday buttons and words
  'Cancel': 'निरस्यत', 'Remove': 'अपनयत', 'Save': 'रक्षत', 'Edit': 'सम्पादयत', 'Delete': 'लोपयत', 'Send': 'प्रेषयत', 'Add': 'योजयत',
  'Approve': 'अनुमोदयत', 'Reject': 'प्रत्याख्यात', 'Close': 'पिधत्त', 'Select all': 'सर्वं चिनुत', 'Print': 'मुद्रयत', 'View': 'पश्यत',
  'Post': 'प्रकाशयत', 'Create': 'रचयत', 'Back': 'पृष्ठतः', 'Copy': 'प्रतिलिखत', 'Done': 'समाप्तम्', 'Manage': 'प्रबन्धयत',
  'Name': 'नाम', 'Title': 'शीर्षकम्', 'Subject': 'विषयः', 'Reason': 'कारणम्', 'Reason (required)': 'कारणम् (आवश्यकम्)', 'Note (optional)': 'टिप्पणी (ऐच्छिकी)',
  'Search by name': 'नाम्ना अन्विष्यत', 'Search by name or email': 'नाम्ना विद्युत्पत्रेण वा अन्विष्यत',
  'Present': 'उपस्थितः', 'Absent': 'अनुपस्थितः', 'Homework': 'गृहकार्यम्', 'Due': 'देयम्', 'Paid': 'दत्तम्', 'Unpaid': 'अदत्तम्',
  'Amount': 'राशिः', 'Fee': 'शुल्कम्', 'Exam': 'परीक्षा', 'Score': 'अङ्काः', 'Grade': 'श्रेणी', 'Teacher': 'शिक्षकः', 'Principal': 'प्रधानाचार्यः',

  // Messages and empty states
  'No messages yet. Ask a question or add details here.': 'सन्देशाः अद्यावधि न सन्ति। अत्र प्रश्नं पृच्छत विवरणं वा योजयत।',
  'Write a message…': 'सन्देशं लिखत…', 'Message not sent': 'सन्देशः न प्रेषितः', 'No students found.': 'छात्राः न प्राप्ताः।',
  'No documents yet.': 'दस्तावेजाः अद्यावधि न सन्ति।', 'No announcements yet.': 'घोषणाः अद्यावधि न सन्ति।', 'No homework yet.': 'गृहकार्यम् अद्यावधि नास्ति।',
  'No conversations yet.': 'संवादाः अद्यावधि न सन्ति।', 'No members in this class yet.': 'अस्यां कक्षायाम् अद्यावधि सदस्याः न सन्ति।',
  'No one matches.': 'कोऽपि न मिलति।',

  // Accounts
  'Password changed': 'गूढशब्दः परिवर्तितः', 'Change password': 'गूढशब्दं परिवर्तयत', 'Current password': 'वर्तमानः गूढशब्दः',
  'New password (8+ characters)': 'नूतनः गूढशब्दः (8+ अक्षराणि)', 'Details saved': 'विवरणं रक्षितम्', 'Saved': 'रक्षितम्',
  'Timetable saved': 'समयसारणी रक्षिता', 'Leave request sent': 'अवकाशयाचना प्रेषिता', 'Class created': 'कक्षा रचिता',
  'Payment received. A receipt is on its way.': 'दत्तं प्राप्तम्। रसीदः प्रेष्यते।', 'Pay online': 'अन्तर्जाले ददातु',
  'Nothing matches. Try a class name or a page like “fees”.': 'किमपि न मिलितम्। कक्षानाम “शुल्कम्” इत्यादिपृष्ठं वा प्रयतत।',
}
export default sa
