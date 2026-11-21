/**
 * KRISHIDHENU Intelligent Farmer Conversational AI Engine
 * 
 * Provides conversational, empathetic, accurate answers grounded in real-time
 * database records for Indian farmers.
 * Supports:
 * - English (default)
 * - Hindi (Devanagari)
 * - Hinglish (Roman script)
 */

export interface FarmerAssistantContext {
  farmer: {
    name: string;
    phone: string;
    farmerCode: string;
    district: string;
    state: string;
  };
  activeBooking: {
    id: string;
    token: string;
    tokenSeq?: number;
    status: string;
    quantityQuintal: number;
    actualQuantity?: number;
    qualityGrade?: string;
    cropName: string;
    cropCode: string;
    mspRate: number;
    centreId: string;
    centreName: string;
    centreCode?: string;
    centreLocation?: string;
    centreDistrict?: string;
    openTime?: string;
    closeTime?: string;
    date: string;
    startTime: string;
    endTime: string;
    position?: number;
  } | null;
  queueMetrics: {
    queuePosition?: number;
    farmersAhead: number;
    estimatedWaitMinutes: number;
    currentlyServingToken: string;
  } | null;
  paymentDetails: {
    id: string;
    tokenNumber: string;
    crop: string;
    finalQuantity: number;
    ratePerUnit: number;
    deductions: number;
    finalPayableAmount: number;
    totalAmount: number;
    paymentStatus: string;
    accountHolderName?: string;
    bankName?: string;
    transactionReference?: string;
    submittedAt?: string;
    paidAt?: string;
  } | null;
  standardMspRates: Array<{
    name: string;
    code: string;
    mspRate: number;
  }>;
}

/**
 * Determines whether a farmer's message requires querying Turso database for
 * personal context (e.g. token status, queue position, active booking, payment status).
 * General questions (founder, what is KRISHIDHENU, general agriculture, MSP explanations)
 * do not need database queries and are answered directly by Gemini AI.
 */
export function isApplicationSpecificQuery(message: string): boolean {
  const m = message.toLowerCase().trim();

  // 1. Explicit General Question Exclusions (Direct to Gemini AI)
  // Founder / Creator queries
  if (/\b(founder|creator|who (created|built|made|founded))\b/i.test(m)) {
    return false;
  }
  // Platform overview queries
  if (/what is (this platform|krishidhenu|krishi dhenu)/i.test(m) || /about krishidhenu/i.test(m)) {
    return false;
  }
  // General MSP educational questions
  if (/(explain|what is|meaning of|kya hai|samjhao|batao)\b.*\bmsp\b/i.test(m) || /\bmsp\b.*(kya|explain|meaning)/i.test(m)) {
    return false;
  }
  // General greetings & small talk
  if (/^(hello|hi|hey|namaste|namaskar|pranam|greetings|good (morning|afternoon|evening)|how are you|kaise ho|kya haal)/i.test(m) && m.length < 35) {
    return false;
  }

  // 2. Personal / Application-Specific Keywords that require Database Context
  const appPatterns = [
    /\b(my|mera|meri|mere|apna|apni|mujhe)\b/i,
    /\b(token|booking|slot|queue|position|baari|bari)\b/i,
    /\b(payment|paisa|paise|amount|disbursement|bank|rupaye)\b/i,
    /\b(centre|center|mandi)\b.*\b(time|timing|open|close|kahan|location|load|status)\b/i,
    /\b(status|turn|wait|waiting|ahead|line|serving)\b/i,
    /\b(farmer code|profile|account details)\b/i,
    /\b(overview|statistics|stats|disbursed|total bookings|completed today|active queue)\b/i,
    /\b(टोकन|बुकिंग|स्लॉट|कतार|बारी|भुगतान|पैसे|खाता|मंडी समय|आंकड़े)\b/,
  ];

  return appPatterns.some((pattern) => pattern.test(m));
}

export function generateIntelligentFarmerResponse(params: {
  message: string;
  context: FarmerAssistantContext;
  language: "en" | "hi" | "hinglish";
  sessionName: string;
}): string {
  const { message, context, language, sessionName } = params;
  const msgLower = message.toLowerCase();
  const name = sessionName || context.farmer.name || "Farmer";
  const { activeBooking, queueMetrics, paymentDetails, standardMspRates } = context;

  // Format MSP Summary text
  const mspLines = standardMspRates && standardMspRates.length > 0
    ? standardMspRates.map((c) => `• ${c.name}: ₹${c.mspRate.toLocaleString("en-IN")}/quintal`).join("\n")
    : "• Wheat (गेहूं): ₹2,275/quintal\n• Mustard (सरसों): ₹5,650/quintal\n• Bajra (बाजरा): ₹2,500/quintal\n• Gram (चना): ₹5,440/quintal\n• Paddy (धान): ₹2,300/quintal";

  // Intent 1: Queue Position & Turn Status
  const isQueueTurnIntent =
    msgLower.includes("queue") ||
    msgLower.includes("turn") ||
    msgLower.includes("wait") ||
    msgLower.includes("ahead") ||
    msgLower.includes("line") ||
    msgLower.includes("position") ||
    msgLower.includes("baari") ||
    msgLower.includes("bari") ||
    msgLower.includes("number kab") ||
    msgLower.includes("aage kitne") ||
    msgLower.includes("kitni der") ||
    msgLower.includes("kitna time") ||
    msgLower.includes("बारी") ||
    msgLower.includes("कतार") ||
    msgLower.includes("नंबर") ||
    msgLower.includes("प्रतीक्षा");

  if (isQueueTurnIntent) {
    if (activeBooking) {
      const token = activeBooking.token;
      const crop = activeBooking.cropName;
      const centre = activeBooking.centreName;
      const position = queueMetrics?.queuePosition ?? activeBooking.position ?? 1;
      const ahead = queueMetrics?.farmersAhead ?? 0;
      const waitMins = queueMetrics?.estimatedWaitMinutes ?? (ahead * 15);
      const serving = queueMetrics?.currentlyServingToken || "Not started yet";

      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nआपकी कतार और तुलाई की स्थिति इस प्रकार है:\n• **सक्रिय टोकन:** ${token} (${crop})\n• **खरीद केंद्र:** ${centre}\n• **कतार में स्थान:** #${position}\n• **वर्तमान में जारी टोकन:** ${serving}\n• **आपसे आगे किसान:** ${ahead}\n• **अनुमानित प्रतीक्षा समय:** लगभग ${waitMins} मिनट\n\n💡 *सुझाव: कृपया अपनी बारी आने पर अपनी उपज और वाहन तुलाई कांटे के समीप तैयार रखें।*`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAapki queue aur tulai ki real-time position:\n• **Active Token:** ${token} (${crop})\n• **Mandi Centre:** ${centre}\n• **Queue Position:** #${position}\n• **Currently Serving Token:** ${serving}\n• **Aapse Aage Farmers:** ${ahead}\n• **Estimated Wait Time:** Lagbhag ${waitMins} minutes\n\n💡 *Tip: Apni baari aane par Mandi weighbridge ke paas vehicle ready rakhein.*`;
      } else {
        return `Greetings ${name},\n\nHere is your real-time queue and turn status:\n• **Active Token:** ${token} (${crop})\n• **Procurement Centre:** ${centre}\n• **Queue Position:** #${position}\n• **Currently Serving:** Token ${serving}\n• **Farmers Ahead of You:** ${ahead}\n• **Estimated Wait Time:** ~${waitMins} minutes\n\n💡 *Tip: Please have your vehicle and produce ready near the weighbridge when your turn approaches.*`;
      }
    } else {
      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nआपके पास वर्तमान में कोई सक्रिय कतार टोकन नहीं है।\n\nकतार में अपना स्थान और तुलाई का समय प्राप्त करने के लिए कृपया अपने डैशबोर्ड पर **"Book Slot"** विकल्प का उपयोग करके नया स्लॉट बुक करें। स्लॉट बुक होते ही आपको तुरंत टोकन नंबर मिल जाएगा।`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAapke paas abhi koi active queue token nahi hai.\n\nQueue me apni baari aur token pane ke liye dashboard par **"Book Slot"** option use karke naya slot book karein. Slot book hote hi aapko turant token number mil jayega.`;
      } else {
        return `Greetings ${name},\n\nYou do not currently have an active queue token.\n\nTo join the queue and get your estimated wait time, please book an appointment slot using the **"Book Slot"** option on your dashboard. Once booked, your digital token and queue turn will be generated immediately.`;
      }
    }
  }

  // Intent 2: Token Status & Active Booking Details
  const isTokenStatusIntent =
    msgLower.includes("token") ||
    msgLower.includes("booking status") ||
    msgLower.includes("my booking") ||
    msgLower.includes("appointment") ||
    msgLower.includes("टोकन") ||
    msgLower.includes("बुकिंग");

  if (isTokenStatusIntent) {
    if (activeBooking) {
      const token = activeBooking.token;
      const crop = activeBooking.cropName;
      const qty = activeBooking.quantityQuintal;
      const centre = activeBooking.centreName;
      const location = activeBooking.centreLocation || activeBooking.centreDistrict || "";
      const date = activeBooking.date;
      const slotTime = `${activeBooking.startTime} - ${activeBooking.endTime}`;
      const status = activeBooking.status;

      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nआपके सक्रिय खरीद टोकन का विवरण निम्नलिखित है:\n• **टोकन संख्या:** ${token}\n• **फसल:** ${crop} (${qty} क्विंटल)\n• **खरीद केंद्र:** ${centre} ${location ? `(${location})` : ""}\n• **दिनांक:** ${date}\n• **समय स्लॉट:** ${slotTime}\n• **स्थिति:** ${status}\n\nकृपया केंद्र पर आते समय अपना आधार कार्ड, बैंक पासबुक और गिरदावरी साथ लाएं।`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAapka active procurement token details ye hain:\n• **Token Number:** ${token}\n• **Fasal (Crop):** ${crop} (${qty} Quintals)\n• **Mandi Centre:** ${centre} ${location ? `(${location})` : ""}\n• **Date:** ${date}\n• **Slot Time:** ${slotTime}\n• **Current Status:** ${status}\n\nKripya Mandi aate samay Aadhaar, Bank Passbook aur Jamabandi / Girdawari copy saath layein.`;
      } else {
        return `Greetings ${name},\n\nHere are your active procurement token details:\n• **Token Number:** ${token}\n• **Crop:** ${crop} (${qty} Quintals)\n• **Procurement Centre:** ${centre} ${location ? `(${location})` : ""}\n• **Scheduled Date:** ${date}\n• **Time Slot:** ${slotTime}\n• **Status:** ${status}\n\nPlease carry your Aadhaar card, bank passbook, and land girdawari copy when visiting the procurement centre.`;
      }
    } else {
      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nवर्तमान में आपका कोई सक्रिय टोकन नहीं है। आप अपने डैशबोर्ड पर **"Book Slot"** बटन दबाकर आसानी से नया टोकन प्राप्त कर सकते हैं।`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAbhi aapka koi active token nahi hai. Aap dashboard par **"Book Slot"** button use karke naya booking token prapt kar sakte hain.`;
      } else {
        return `Greetings ${name},\n\nYou do not currently have an active booking token. You can easily generate one by clicking **"Book Slot"** on your farmer dashboard.`;
      }
    }
  }

  // Intent 3: How to Book a Slot / Step-by-Step Guide
  const isBookingGuideIntent =
    msgLower.includes("how can i book") ||
    msgLower.includes("how to book") ||
    msgLower.includes("book a slot") ||
    msgLower.includes("booking karni") ||
    msgLower.includes("slot kaise") ||
    msgLower.includes("kaise book") ||
    msgLower.includes("स्लॉट कैसे") ||
    msgLower.includes("बुकिंग कैसे");

  if (isBookingGuideIntent) {
    if (language === "hi") {
      return `नमस्ते ${name} जी,\n\nकृषिधेनु पर खरीद स्लॉट बुक करना बहुत आसान है:\n\n1. **डैशबोर्ड पर जाएं:** अपने किसान पोर्टल डैशबोर्ड को खोलें।\n2. **'Book Slot' चुनें:** त्वरित मेनू में 'Book Slot' बटन पर क्लिक करें।\n3. **फसल व मात्रा चुनें:** अपनी फसल (जैसे गेहूं, सरसों) और मात्रा (क्विंटल में) दर्ज करें।\n4. **खरीद केंद्र व स्लॉट चुनें:** अपना नजदीकी केंद्र और सुविधाजनक समय स्लॉट चुनें।\n5. **कन्फर्म करें:** पुष्टि करते ही आपको तुरंत डिजिटल टोकन नंबर मिल जाएगा।`;
    } else if (language === "hinglish") {
      return `Namaste ${name} ji,\n\nKRISHIDHENU par slot book karne ke simple steps:\n\n1. **Dashboard:** Apne Farmer Dashboard par jayein.\n2. **'Book Slot' Click:** Menu me se 'Book Slot' button par tap karein.\n3. **Crop & Quantity:** Apni fasal (Wheat, Mustard, etc.) aur quantity (quintal me) select karein.\n4. **Centre & Slot:** Nearest Mandi centre aur convenient time slot choose karein.\n5. **Confirm:** Submit karte hi aapka digital Token Number turant generate ho jayega.`;
    } else {
      return `Greetings ${name},\n\nHere is how you can book a procurement slot on KRISHIDHENU:\n\n1. **Go to Dashboard:** Navigate to your Farmer Dashboard.\n2. **Click 'Book Slot':** Tap the Book Slot button in the quick navigation menu.\n3. **Select Crop & Quantity:** Choose your crop (e.g., Wheat, Mustard) and enter quantity in quintals.\n4. **Choose Mandi & Slot:** Select your nearest procurement centre and preferred date/time slot.\n5. **Confirm:** Submit your booking to instantly receive your digital Token Number and SMS confirmation.`;
    }
  }

  // Intent 4: MSP Rates & Crop Pricing
  const isMspIntent =
    msgLower.includes("msp") ||
    msgLower.includes("rate") ||
    msgLower.includes("price") ||
    msgLower.includes("wheat") ||
    msgLower.includes("mustard") ||
    msgLower.includes("bajra") ||
    msgLower.includes("gehu") ||
    msgLower.includes("gehun") ||
    msgLower.includes("sarson") ||
    msgLower.includes("chana") ||
    msgLower.includes("bhav") ||
    msgLower.includes("भाव") ||
    msgLower.includes("न्यूनतम समर्थन मूल्य");

  if (isMspIntent) {
    // Check specific crop
    let specificCrop = "";
    if (msgLower.includes("wheat") || msgLower.includes("gehu") || msgLower.includes("गेहूं")) {
      specificCrop = "Wheat (गेहूं) MSP is **₹2,275 per quintal**";
    } else if (msgLower.includes("mustard") || msgLower.includes("sarson") || msgLower.includes("सरसों")) {
      specificCrop = "Mustard (सरसों) MSP is **₹5,650 per quintal**";
    } else if (msgLower.includes("bajra") || msgLower.includes("बाजरा")) {
      specificCrop = "Bajra (बाजरा) MSP is **₹2,500 per quintal**";
    } else if (msgLower.includes("gram") || msgLower.includes("chana") || msgLower.includes("चना")) {
      specificCrop = "Gram / Chana (चना) MSP is **₹5,440 per quintal**";
    } else if (msgLower.includes("paddy") || msgLower.includes("rice") || msgLower.includes("धान")) {
      specificCrop = "Paddy / Rice (धान) MSP is **₹2,300 per quintal**";
    }

    if (language === "hi") {
      return `नमस्ते ${name} जी,\n\n${specificCrop ? `🌾 **${specificCrop}**\n\n` : ""}📋 **आधिकारिक न्यूनतम समर्थन मूल्य (MSP दरें):**\n${mspLines}\n\nखरीद केंद्रों पर सरकार द्वारा निर्धारित इन दरों पर सीधी खरीद की जाती है और बिना किसी बिचौलिये के पूरा भुगतान सीधे आपके बैंक खाते में भेजा जाता है।`;
    } else if (language === "hinglish") {
      return `Namaste ${name} ji,\n\n${specificCrop ? `🌾 **${specificCrop}**\n\n` : ""}📋 **Official Minimum Support Price (MSP Rates):**\n${mspLines}\n\nGovernment Mandi centres par inhi official rates par khareed hoti hai aur poora payment direct aapke bank account me DBT ke dwara credit hota hai.`;
    } else {
      return `Greetings ${name},\n\n${specificCrop ? `🌾 **${specificCrop}**\n\n` : ""}📋 **Official Minimum Support Price (MSP) Rates:**\n${mspLines}\n\nProcurement at all KRISHIDHENU centres is carried out strictly at these government-approved rates, with direct DBT transfer to your verified bank account.`;
    }
  }

  // Intent 5: Payment & DBT Disbursement Status
  const isPaymentIntent =
    msgLower.includes("payment") ||
    msgLower.includes("dbt") ||
    msgLower.includes("money") ||
    msgLower.includes("paisa") ||
    msgLower.includes("paise") ||
    msgLower.includes("account") ||
    msgLower.includes("bhugtan") ||
    msgLower.includes("खाता") ||
    msgLower.includes("भुगतान") ||
    msgLower.includes("रुपये");

  if (isPaymentIntent) {
    if (paymentDetails) {
      const amt = paymentDetails.finalPayableAmount?.toLocaleString("en-IN") || paymentDetails.totalAmount?.toLocaleString("en-IN") || "0";
      const status = paymentDetails.paymentStatus || "PENDING";
      const bank = paymentDetails.bankName || "Aadhaar Linked Bank";
      const utr = paymentDetails.transactionReference || "Processing via PFMS";

      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nआपके भुगतान की स्थिति:\n• **भुगतान स्थिति:** ${status}\n• **कुल देय राशि:** ₹${amt}\n• **बैंक:** ${bank}\n• **लेन-देन संदर्भ (UTR):** ${utr}\n\nभुगतान सीधे आपके आधार लिंक बैंक खाते में डीबीटी (DBT) के माध्यम से भेजा जाता है।`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAapke payment ki status:\n• **Payment Status:** ${status}\n• **Payable Amount:** ₹${amt}\n• **Bank:** ${bank}\n• **Transaction Reference:** ${utr}\n\nPayment direct aapke Aadhaar linked bank account me DBT ke dwara transfer kiya jata hai.`;
      } else {
        return `Greetings ${name},\n\nHere is your verified payment status:\n• **Payment Status:** ${status}\n• **Net Payable Amount:** ₹${amt}\n• **Bank:** ${bank}\n• **Transaction Reference:** ${utr}\n\nProcurement payments are deposited directly via Direct Benefit Transfer (DBT) into your registered bank account.`;
      }
    } else {
      if (language === "hi") {
        return `नमस्ते ${name} जी,\n\nवर्तमान में आपके किसी टोकन का लंबित भुगतान रिकॉर्ड नहीं है।\n\n💡 **भुगतान नियम:** खरीद केंद्र पर फसल की तुलाई और गुणवत्ता जांच पूरी होने के 48 से 72 घंटों के भीतर पूरा भुगतान सीधे आपके बैंक खाते में डीबीटी (DBT) द्वारा जमा किया जाता है।`;
      } else if (language === "hinglish") {
        return `Namaste ${name} ji,\n\nAbhi aapka koi pending payment record nahi hai.\n\n💡 **Payment Timeline:** Mandi par weighment aur quality check complete hone ke 48-72 hours ke andar poora payment direct aapke bank account me DBT ke through transfer ho jata hai.`;
      } else {
        return `Greetings ${name},\n\nYou do not currently have a pending payment record.\n\n💡 **DBT Timeline:** Once your produce is weighed and quality-verified at the procurement centre, the payment is directly credited to your Aadhaar-linked bank account via DBT within 48 to 72 hours.`;
      }
    }
  }

  // Intent 6: Moisture & Quality Grading Guidelines
  const isQualityIntent =
    msgLower.includes("moisture") ||
    msgLower.includes("quality") ||
    msgLower.includes("nami") ||
    msgLower.includes("grading") ||
    msgLower.includes("standard") ||
    msgLower.includes("fssai") ||
    msgLower.includes("नमी") ||
    msgLower.includes("गुणवत्ता");

  if (isQualityIntent) {
    if (language === "hi") {
      return `नमस्ते ${name} जी,\n\n🌾 **अनाज गुणवत्ता एवं नमी मानक:**\n• **स्वीकार्य मानक नमी:** 12.0% तक (पूर्ण मूल्य भुगतान)।\n• **12.1% से 14.0% नमी:** आनुपातिक मानक कटौती लागू होती है।\n• **14.0% से अधिक नमी:** उपज को धूप में सुखाने की आवश्यकता होती है।\n\n⚖️ **किसान अधिकार:** यदि आप नमी मापक रीडिंग से असंतुष्ट हैं, तो आपको रसीद पर हस्ताक्षर करने से पहले दूसरे नमूने की पुनः जांच (Second Sample Test) का कानूनी अधिकार है। केंद्र कर्मचारी कोई मनमानी नकद कटौती नहीं कर सकते।`;
    } else if (language === "hinglish") {
      return `Namaste ${name} ji,\n\n🌾 **Quality & Moisture Guidelines:**\n• **Standard Moisture Limit:** Up to 12.0% (Poora full MSP milta hai).\n• **12.1% - 14.0% Moisture:** Proportional standard deduction apply hota hai.\n• **Above 14.0% Moisture:** Grain ko dhoop me sukhane ki zaroorat hoti hai.\n\n⚖️ **Farmer Rights:** Agar aap moisture reading se agree nahi karte, toh receipt sign karne se pehle second sample re-test request karne ka aapko statutory adhikaar hai. Staff koi arbitrary cash deduction nahi le sakta.`;
    } else {
      return `Greetings ${name},\n\n🌾 **Quality & Moisture Standards (CACP/FCI):**\n• **Standard Moisture Limit:** Up to 12.0% (100% full MSP payment).\n• **12.1% to 14.0% Moisture:** Proportional standard value deduction applies transparently.\n• **Above 14.0% Moisture:** Produce requires sun-drying before weighment.\n\n⚖️ **Farmer Statutory Rights:** If you dispute any moisture reading, you have the statutory right to demand a second sample test before signing the procurement receipt. No procurement staff is authorized to levy arbitrary cash deductions.`;
    }
  }

  // Default: Conversational Assistance & Status Overview
  const activeTokenText = activeBooking ? `Token: ${activeBooking.token} (${activeBooking.cropName})` : "No active token";

  if (language === "hi") {
    return `नमस्ते ${name} जी!\n\nयह कृषिधेनु सहायक (सत्यापित डेटाबेस मोड) है। मैं आपकी खरीद, कतार और भुगतान से जुड़ी सत्यापित जानकारी में सहायता कर सकता हूँ।\n\n• **वर्तमान स्थिति:** ${activeTokenText}\n• **उपलब्ध सेवाएं:** स्लॉट बुकिंग, कतार में अपनी बारी जांचना, आधिकारिक MSP दरें, नमी मानक और भुगतान स्थिति।\n\nआप नीचे दिए गए त्वरित विकल्पों में से चुन सकते हैं या अपना प्रश्न यहां लिख सकते हैं!`;
  } else if (language === "hinglish") {
    return `Namaste ${name} ji!\n\nMain aapka KRISHIDHENU Assistant (Database Records Mode) hoon. Main aapki Mandi procurement, token, queue aur DBT payment me poori help kar sakta hoon.\n\n• **Current Status:** ${activeTokenText}\n• **Available Services:** Slot booking, queue turn inquiry, official MSP rates, moisture guidelines aur DBT payment tracking.\n\nAap neeche diye options me se select karein ya apna question poochhein!`;
  } else {
    return `Hello ${name}!\n\nI am your KRISHIDHENU Assistant (Database Records Mode). I can assist you with your procurement token, queue turn, Mandi timings, official MSP rates, and DBT payment details.\n\n• **Current Status:** ${activeTokenText}\n• **Available Actions:** Check queue turn, view token status, learn how to book a slot, check official MSP rates, or track payment.\n\nFeel free to ask your question or tap any of the quick suggestions below!`;
  }
}
