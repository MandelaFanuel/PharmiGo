import { phoneCountries, type PhoneCountryCode } from "../lib/phoneCountries";

type PhoneNumberFieldProps = {
  countryCode: PhoneCountryCode;
  localNumber: string;
  onCountryChange: (value: PhoneCountryCode) => void;
  onLocalNumberChange: (value: string) => void;
  label: string;
  error?: string;
  name?: string;
};

export default function PhoneNumberField({
  countryCode,
  localNumber,
  onCountryChange,
  onLocalNumberChange,
  label,
  error,
  name,
}: PhoneNumberFieldProps) {
  const selectedCountry = phoneCountries.find((item) => item.code === countryCode) ?? phoneCountries[0];

  return (
    <label>
      <span>{label}</span>
      <div className={error ? "phone-field phone-field-error" : "phone-field"}>
        <select
          className="phone-country-select"
          value={countryCode}
          onChange={(event) => onCountryChange(event.target.value as PhoneCountryCode)}
          aria-label={`${label} pays`}
        >
          {phoneCountries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.flag} {country.name} {country.dialCode}
            </option>
          ))}
        </select>
        <div className="phone-dial-code">{selectedCountry.dialCode}</div>
        <input
          name={name}
          type="tel"
          inputMode="numeric"
          placeholder={selectedCountry.placeholder}
          value={localNumber}
          onChange={(event) => onLocalNumberChange(event.target.value.replace(/\D/g, ""))}
        />
      </div>
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}
