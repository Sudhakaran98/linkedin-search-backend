module.exports = (sequelize, DataTypes) => {
  const Education = sequelize.define("Education", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    profile_id: DataTypes.BIGINT,
    institution_id: DataTypes.BIGINT,
    degree: DataTypes.TEXT,
    date_from_year: DataTypes.TEXT,
    date_to_year: DataTypes.TEXT,
    description: DataTypes.TEXT,
    order_in_profile: DataTypes.INTEGER,
    activities_and_societies: DataTypes.TEXT,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
    // denormalized institution fields — stored during ingestion, normalized later
    institution_name: DataTypes.TEXT,
    institution_url: DataTypes.TEXT,
    institution_logo_url: DataTypes.TEXT,
    institution_full_address: DataTypes.TEXT,
    institution_country_iso2: DataTypes.TEXT,
    institution_country_iso3: DataTypes.TEXT,
    institution_regions: DataTypes.ARRAY(DataTypes.TEXT),
    institution_city: DataTypes.TEXT,
    institution_state: DataTypes.TEXT,
    institution_street: DataTypes.TEXT,
    institution_zipcode: DataTypes.TEXT,
  }, {
    tableName: "profile_educations",
    schema: "linkedin",
    timestamps: true
  });

  return Education;
};
