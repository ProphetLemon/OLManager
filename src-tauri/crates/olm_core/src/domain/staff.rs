use serde::{Deserialize, Deserializer, Serialize};
#[cfg(feature = "typescript")]
use ts_rs::TS;

fn deserialize_null_to_empty<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(|opt| opt.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct Staff {
    pub id: String,
    #[serde(default, deserialize_with = "deserialize_null_to_empty")]
    pub nickname: String,
    #[serde(default, deserialize_with = "deserialize_null_to_empty")]
    pub first_name: String,
    #[serde(default, deserialize_with = "deserialize_null_to_empty")]
    pub last_name: String,
    #[serde(default, deserialize_with = "deserialize_null_to_empty")]
    pub date_of_birth: String,
    #[serde(default)]
    pub nationality: String,
    #[serde(default)]
    pub birth_country: Option<String>,
    #[serde(default)]
    pub profile_image_url: Option<String>,
    pub role: StaffRole,

    // Attributes 0-100
    #[serde(default)]
    pub attributes: StaffAttributes,
    pub team_id: Option<String>,

    // Contract & finances
    #[serde(default, deserialize_with = "crate::domain::serde_util::lenient_u32")]
    pub wage: u32,
    #[serde(default)]
    pub contract_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum StaffRole {
    #[serde(alias = "Assistant")]
    AssistantManager,
    #[serde(alias = "HeadCoach", alias = "Analyst", alias = "Performance Coach")]
    Coach,
    Scout,
    Physio,
    Owner,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct StaffAttributes {
    #[serde(default)]
    pub coaching: u8,
    #[serde(default)]
    pub judging_ability: u8,
    #[serde(default)]
    pub judging_potential: u8,
    #[serde(default)]
    pub physiotherapy: u8,
}

impl Staff {
    pub fn new(
        id: String,
        first_name: String,
        last_name: String,
        date_of_birth: String,
        role: StaffRole,
        attributes: StaffAttributes,
    ) -> Self {
        Self {
            id,
            nickname: String::new(),
            first_name,
            last_name,
            date_of_birth,
            nationality: String::new(),
            birth_country: None,
            profile_image_url: None,
            role,
            attributes,
            team_id: None,
            wage: 0,
            contract_end: None,
        }
    }

    /// Whether the source data rated this member at all. A member shipped with
    /// only a name and a role loads with every attribute at 0; the lowest
    /// attribute in the complete data is 44, so 0 on all four means "no data".
    pub fn has_attribute_data(&self) -> bool {
        let a = &self.attributes;
        a.coaching > 0 || a.judging_ability > 0 || a.judging_potential > 0 || a.physiotherapy > 0
    }

    /// A club owner is not part of the hired staff: never hired, never fired and
    /// never counted for staff effects.
    pub fn is_owner(&self) -> bool {
        self.role == StaffRole::Owner
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_staff_accepts_null_wage_and_partial_fields() {
        let staff: Staff = serde_json::from_str(
            r#"{
                "id": "staff-imported",
                "first_name": null,
                "last_name": null,
                "date_of_birth": null,
                "role": "Assistant",
                "wage": null,
                "team_id": "team-1",
                "attributes": { "coaching": 79 }
            }"#,
        )
        .expect("staff should parse");

        assert_eq!(staff.first_name, "");
        assert_eq!(staff.last_name, "");
        assert_eq!(staff.date_of_birth, "");
        assert_eq!(staff.role, StaffRole::AssistantManager);
        assert_eq!(staff.wage, 0);
        assert_eq!(staff.attributes.coaching, 79);
        assert_eq!(staff.attributes.judging_ability, 0);
    }
}
