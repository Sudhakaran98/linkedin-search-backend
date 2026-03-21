module.exports = (sequelize, DataTypes) => {
  const Certification = sequelize.define("Certification", {
    id:{ type:DataTypes.BIGINT, primaryKey:true, autoIncrement:true },
    profile_id: DataTypes.BIGINT,
    title: DataTypes.TEXT,
    issuer: DataTypes.TEXT,
    issuer_url: DataTypes.TEXT,
    credential_id: DataTypes.TEXT,
    certificate_url: DataTypes.TEXT,
    certificate_logo_url: DataTypes.TEXT,
    date_from: DataTypes.TEXT,
    date_from_year: DataTypes.INTEGER,
    date_from_month: DataTypes.INTEGER,
    date_to: DataTypes.TEXT,
    date_to_year: DataTypes.INTEGER,
    date_to_month: DataTypes.INTEGER,
    order_in_profile: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },{
    tableName:"profile_certifications",
    schema:"linkedin",
    timestamps:true
  });

  return Certification;
};