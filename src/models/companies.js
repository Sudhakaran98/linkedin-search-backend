module.exports = (sequelize, DataTypes) => {
    const Company = sequelize.define("Company", {
        id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
        company_name: DataTypes.TEXT,
        company_type: DataTypes.TEXT,
        company_founded_year: DataTypes.TEXT,
        company_followers_count: DataTypes.TEXT,
        company_website: DataTypes.TEXT,
        company_facebook_url: DataTypes.ARRAY(DataTypes.TEXT),
        company_twitter_url: DataTypes.ARRAY(DataTypes.TEXT),
        company_linkedin_url: DataTypes.TEXT,
        company_logo_url: DataTypes.TEXT,
        company_size_range: DataTypes.TEXT,
        company_employees_count: DataTypes.TEXT,
        company_industry: DataTypes.TEXT,
        company_categories_and_keywords: DataTypes.ARRAY(DataTypes.TEXT),
        company_annual_revenue_source_1: DataTypes.TEXT,
        company_annual_revenue_currency_source_1: DataTypes.TEXT,
        company_annual_revenue_source_5: DataTypes.TEXT,
        company_annual_revenue_currency_source_5: DataTypes.TEXT,
        company_employees_count_change_yearly_percentage: DataTypes.TEXT,
        company_last_funding_round_date: DataTypes.TEXT,
        company_last_funding_round_amount_raised: DataTypes.TEXT,
        company_hq_full_address: DataTypes.TEXT,
        company_hq_country: DataTypes.TEXT,
        company_hq_regions: DataTypes.ARRAY(DataTypes.TEXT),
        company_hq_country_iso2: DataTypes.TEXT,
        company_hq_country_iso3: DataTypes.TEXT,
        company_hq_city: DataTypes.TEXT,
        company_hq_state: DataTypes.TEXT,
        company_hq_street: DataTypes.TEXT,
        company_hq_zipcode: DataTypes.TEXT,
        company_last_updated_at: DataTypes.DATE,
        company_stock_ticker: DataTypes.ARRAY(DataTypes.TEXT),
        company_is_b2b: DataTypes.BOOLEAN,
        created_at: DataTypes.DATE,
        updated_at: DataTypes.DATE
    }, {
        tableName: "companies",
        schema: "linkedin",
        timestamps: true
    });

    return Company;
};