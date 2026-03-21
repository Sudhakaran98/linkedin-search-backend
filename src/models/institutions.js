module.exports = (sequelize, DataTypes) => {
    const Institution = sequelize.define("Institution", {
        id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
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
        created_at: DataTypes.DATE,
        updated_at: DataTypes.DATE
    }, {
        tableName: "institutions",
        schema: "linkedin",
        timestamps: true
    });

    return Institution;
};