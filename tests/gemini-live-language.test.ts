import { describe, expect, it } from "vitest";

import { isClearlyNonEnglish } from "@/lib/gemini-live/language";

describe("isClearlyNonEnglish", () => {
  it("never counts short, garbled or accented-English captions", () => {
    for (const t of ["las Andes", "las Andy interview", "Oh, ja.", "É.", "Enseguida.", "Baja baja baja"]) {
      expect(isClearlyNonEnglish(t)).toBe(false);
    }
  });

  it("treats real English answers as English", () => {
    expect(isClearlyNonEnglish("I built a movie genre classifier in Python with scikit-learn.")).toBe(false);
    expect(isClearlyNonEnglish("Let's end this interview now please, thank you.")).toBe(false);
  });

  it("flags full sentences in another language, in any script", () => {
    expect(isClearlyNonEnglish("Hola, me llamo Juan y trabajo como ingeniero de datos.")).toBe(true);
    expect(isClearlyNonEnglish("ကျွန်တော် အင်ဂျင်နီယာ အလုပ် လုပ်ပါတယ် ခင်ဗျာ ကျေးဇူးတင်ပါတယ်")).toBe(true);
  });
});
