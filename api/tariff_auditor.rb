# frozen_string_literal: true

# =============================================================================
#  VOLT-SPECTRA — tariff_auditor.rb
#  Ruby 3.3 Time-of-Use arbitrage engine, vampire-drain accountant and
#  IEEE 519 harmonic-compliance mirror.
#
#  Everything the Android APK needs at runtime is embedded below in
#  OFFLINE_TARIFF_MIRROR / OFFLINE_APPLIANCE_MIRROR / OFFLINE_VAMPIRE_MIRROR,
#  so the auditor works 100% offline in basements, utility closets and
#  off-grid campsites.  The cloud path simply refreshes the mirror.
#
#  Usage:
#    ruby api/tariff_auditor.rb --json
#    ruby api/tariff_auditor.rb --scenario shift-ev-to-offpeak --json
#    ruby api/tariff_auditor.rb --vampire-sweep --json
#    ruby api/tariff_auditor.rb --ieee519 28.4 --harmonics 0,18,11,0,15,0,10,0,5
#    ruby api/tariff_auditor.rb --mirror
# =============================================================================

require 'json'

module VoltSpectra
  VERSION = '1.0.0'

  # ------------------------------------------------------------------ models

  # A shiftable household load.
  Appliance = Data.define(:id, :name, :kw, :hours, :start_hour, :shiftable)

  # One Time-of-Use tier.  +from+/+to+ are hour-of-day bounds (to is
  # exclusive; 24 wraps to midnight).
  Tier = Data.define(:name, :from, :to, :rate_per_kwh)

  TariffSchedule = Data.define(:id, :name, :currency, :blended_rate, :tiers)

  # ----------------------------------------------------------- tariff engine

  class TariffEngine
    attr_reader :schedule

    def initialize(schedule)
      @schedule = schedule
    end

    # Hour-of-day -> tier (24 h wrap).
    def tier_at(hour)
      h = hour % 24
      schedule.tiers.find { |t| t.from < t.to ? (h >= t.from && h < t.to) : (h >= t.from || h < t.to) }
    end

    def rate_at(hour)
      tier_at(hour)&.rate_per_kwh || schedule.blended_rate
    end

    # Full 24-hour rate curve, the backbone of the TOU visualizer.
    def tou_curve
      (0...24).map { |h| { hour: h, rate: rate_at(h), tier: tier_at(h)&.name } }
    end

    # Energy (kWh) for a load of +kw+ running +hours+ starting at +start_hour+,
    # walking hour-by-hour through the rate curve.
    def energy_cost(kw, hours, start_hour, curve = tou_curve)
      total = 0.0
      hours.to_i.times do |i|
        slot = curve[(start_hour + i) % 24]
        total += kw * slot[:rate]
      end
      total
    end

    # Baseline (as-scheduled) vs. shifted cost for a list of appliances.
    # +shifts+ maps appliance id -> new start hour.
    def arbitrage(appliances, shifts = {})
      per_appliance = appliances.map do |app|
        base = energy_cost(app.kw, app.hours, app.start_hour)
        target = shifts.fetch(app.id, app.start_hour)
        shifted = app.shiftable ? energy_cost(app.kw, app.hours, target) : base
        {
          id: app.id,
          name: app.name,
          kw: app.kw,
          hours: app.hours,
          from_hour: app.start_hour,
          to_hour: target,
          shiftable: app.shiftable,
          baseline_usd: base.round(2),
          shifted_usd: shifted.round(2),
          savings_usd: (base - shifted).round(2)
        }
      end

      baseline = per_appliance.sum { |a| a[:baseline_usd] }
      shifted = per_appliance.sum { |a| a[:shifted_usd] }
      {
        schedule: schedule.name,
        currency: schedule.currency,
        per_appliance:,
        baseline_daily_usd: baseline.round(2),
        shifted_daily_usd: shifted.round(2),
        savings_daily_usd: (baseline - shifted).round(2),
        savings_monthly_usd: ((baseline - shifted) * 30.0).round(2),
        savings_annual_usd: ((baseline - shifted) * 365.0).round(2)
      }
    end

    # Auto-shift every shiftable load into the cheapest +window_hours+ that
    # can contain its runtime, starting the search at +earliest+.
    def auto_shift(appliances, earliest: 22, window_hours: 8, curve = tou_curve)
      cheapest = curve.min_by { |s| s[:rate] }
      shifts = {}
      appliances.select(&:shiftable).each do |app|
        best_start = app.start_hour
        best_cost = energy_cost(app.kw, app.hours, app.start_hour, curve)
        (0...24).each do |start|
          next if (start - earliest) % 24 > window_hours
          cost = energy_cost(app.kw, app.hours, start, curve)
          if cost < best_cost
            best_cost = cost
            best_start = start
          end
        end
        shifts[app.id] = best_start
      end
      { shifts:, cheapest_hour: cheapest[:hour], cheapest_rate: cheapest[:rate] }
    end

    # 100 A / 200 A main-panel headroom check (split-phase 240 V service).
    def panel_headroom(panel_amps, voltage, concurrent_kw)
      capacity_kw = (panel_amps * voltage) / 1000.0
      {
        panel_amps:,
        voltage:,
        capacity_kw: capacity_kw.round(2),
        concurrent_kw: concurrent_kw.round(2),
        headroom_kw: (capacity_kw - concurrent_kw).round(2),
        load_percent: ((concurrent_kw / capacity_kw) * 100.0).round(1),
        trips: concurrent_kw > capacity_kw * 0.8
      }
    end
  end

  # --------------------------------------------------------- vampire catalog

  module VampireCatalog
    module_function

    HOURS_PER_YEAR = 8760.0

    # kWh/yr and $/yr for a standby load at a blended residential rate.
    def annual_drain(watts, blended_rate)
      kwh = (watts * HOURS_PER_YEAR) / 1000.0
      { standby_w: watts, annual_kwh: kwh.round(1), annual_usd: (kwh * blended_rate).round(2) }
    end

    def sweep(mirror, blended_rate)
      mirror.map do |item|
        drain = annual_drain(item[:standby_w], blended_rate)
        {
          id: item[:id],
          name: item[:name],
          location: item[:location],
          emf_ut: item[:emf_ut],
          hum_hz: item[:hum_hz],
          severity: item[:severity],
          **drain
        }
      end
    end

    def total(swept)
      {
        annual_kwh: swept.sum { |s| s[:annual_kwh] }.round(1),
        annual_usd: swept.sum { |s| s[:annual_usd] }.round(2)
      }
    end
  end

  # ------------------------------------------------------- IEEE 519 mirror

  module HarmonicCompliance
    module_function

    # IEEE 519-2014 Table 1 (representative): voltage distortion limits at the
    # point of common coupling.
    VOLTAGE_THD_LIMITS = {
      '<69kV' => { thd: 5.0, individual: 3.0 },
      '69-161kV' => { thd: 2.5, individual: 1.5 },
      '>161kV' => { thd: 1.5, individual: 1.0 }
    }.freeze

    # IEEE 519-2014 Table 2 (representative): maximum current distortion as a
    # percentage of the fundamental load current, by Isc/Il ratio.
    CURRENT_TDD_LIMITS = [
      { max_ratio: 20, tdd: 4.0 },
      { max_ratio: 50, tdd: 6.0 },
      { max_ratio: 100, tdd: 10.0 },
      { max_ratio: 1000, tdd: 12.0 },
      { max_ratio: Float::INFINITY, tdd: 15.0 }
    ].freeze

    def voltage_limit(bus)
      VOLTAGE_THD_LIMITS.fetch(bus, VOLTAGE_THD_LIMITS['<69kV'])
    end

    def current_limit(isc_over_il)
      CURRENT_TDD_LIMITS.find { |row| isc_over_il < row[:max_ratio] }[:tdd]
    end

    def evaluate(thd_percent, harmonics, bus: '<69kV', isc_over_il: 50)
      vlim = voltage_limit(bus)
      ilim = current_limit(isc_over_il)
      worst = harmonics.map.with_index { |pct, i| { order: i + 1, pct: } }.max_by { |h| h[:pct] }
      {
        bus:,
        thd_percent: thd_percent.round(3),
        voltage_thd_limit: vlim[:thd],
        voltage_compliant: thd_percent <= vlim[:thd],
        worst_harmonic: worst,
        individual_limit: vlim[:individual],
        individual_compliant: worst[:pct] <= vlim[:individual],
        isc_over_il:,
        current_tdd_limit: ilim,
        current_compliant: thd_percent <= ilim,
        compliant: thd_percent <= vlim[:thd] && worst[:pct] <= vlim[:individual] && thd_percent <= ilim
      }
    end
  end

  # ------------------------------------------------- embedded offline mirror

  OFFLINE_TARIFF_MIRROR = {
    'ca_sou_tou' => TariffSchedule.new(
      id: 'ca_sou_tou',
      name: 'CA Solar & Storage TOU (Off 0.12 / Mid 0.24 / Surge 0.52)',
      currency: 'USD',
      blended_rate: 0.20,
      tiers: [
        Tier.new(name: 'Off-Peak', from: 23, to: 6, rate_per_kwh: 0.12),
        Tier.new(name: 'Mid-Peak', from: 6, to: 16, rate_per_kwh: 0.24),
        Tier.new(name: 'Surge Peak', from: 16, to: 21, rate_per_kwh: 0.52),
        Tier.new(name: 'Mid-Peak', from: 21, to: 23, rate_per_kwh: 0.24)
      ]
    ),
    'kenya_power_tou' => TariffSchedule.new(
      id: 'kenya_power_tou',
      name: 'Kenya Power TOU (representative mirror, Meru region)',
      currency: 'KES',
      blended_rate: 20.0,
      tiers: [
        Tier.new(name: 'Off-Peak', from: 23, to: 6, rate_per_kwh: 12.0),
        Tier.new(name: 'Mid-Peak', from: 6, to: 16, rate_per_kwh: 24.0),
        Tier.new(name: 'Surge Peak', from: 16, to: 21, rate_per_kwh: 52.0),
        Tier.new(name: 'Mid-Peak', from: 21, to: 23, rate_per_kwh: 24.0)
      ]
    )
  }.freeze

  OFFLINE_APPLIANCE_MIRROR = [
    Appliance.new(id: 'ev', name: 'EV Charger', kw: 7.2, hours: 4, start_hour: 17, shiftable: true),
    Appliance.new(id: 'dryer', name: 'Electric Clothes Dryer', kw: 4.5, hours: 1, start_hour: 18, shiftable: true),
    Appliance.new(id: 'dishwasher', name: 'Dishwasher', kw: 1.8, hours: 2, start_hour: 19, shiftable: true),
    Appliance.new(id: 'pool', name: 'Pool Pump', kw: 2.2, hours: 6, start_hour: 15, shiftable: true),
    Appliance.new(id: 'heater', name: 'Space Heater', kw: 1.5, hours: 5, start_hour: 17, shiftable: true)
  ].freeze

  OFFLINE_VAMPIRE_MIRROR = [
    { id: 'console', name: 'Gaming Console in Instant-On Standby', location: 'Living room media shelf', standby_w: 42, emf_ut: 38.5, hum_hz: 120, severity: 'vampire' },
    { id: 'dvr', name: 'Old Cable/DVR Box', location: 'TV stand', standby_w: 35, emf_ut: 27.2, hum_hz: 120, severity: 'vampire' },
    { id: 'wallwart', name: 'Hot Failing Wall-Wart Transformer', location: 'Hallway outlet', standby_w: 18, emf_ut: 64.1, hum_hz: 100, severity: 'fire' },
    { id: 'strip', name: 'Smart Power Strip in Eco-Cutoff', location: 'Office desk', standby_w: 0.4, emf_ut: 2.1, hum_hz: 0, severity: 'clean' }
  ].freeze

  # --------------------------------------------------------------- CLI entry

  module CLI
    module_function

    def schedule(id)
      OFFLINE_TARIFF_MIRROR.fetch(id) { OFFLINE_TARIFF_MIRROR['ca_sou_tou'] }
    end

    def run(argv)
      args = argv.dup
      json = args.delete('--json')
      if args.include?('--help') || args.include?('-h')
        puts <<~HELP
          VOLT-SPECTRA tariff auditor v#{VERSION}
            --json                     emit machine-readable JSON
            --scenario shift-ev        shift the EV charger to off-peak
            --vampire-sweep            audit the offline vampire catalog
            --ieee519 THD --harmonics 0,18,11,0,15,0,10,0,5
            --panel 100|200 --load KW  main-panel headroom check
            --mirror                   dump the embedded offline mirror
        HELP
        return 0
      end

      if args.delete('--mirror')
        payload = {
          version: VERSION,
          schedules: OFFLINE_TARIFF_MIRROR.transform_values(&:to_h),
          appliances: OFFLINE_APPLIANCE_MIRROR.map(&:to_h),
          vampires: OFFLINE_VAMPIRE_MIRROR
        }
        puts json ? JSON.pretty_generate(payload) : payload.inspect
        return 0
      end

      if args.delete('--vampire-sweep')
        sched = schedule('ca_sou_tou')
        swept = VampireCatalog.sweep(OFFLINE_VAMPIRE_MIRROR, sched.blended_rate)
        payload = { schedule: sched.name, swept:, total: VampireCatalog.total(swept) }
        puts json ? JSON.pretty_generate(payload) : swept.inspect
        return 0
      end

      if args.delete('--ieee519')
        thd = (args.shift || '0').to_f
        harmonics = (args.shift || '').split(',').map(&:to_f)
        harmonics = [0, 0, 0, 0, 0, 0, 0, 0, 0] if harmonics.empty?
        result = HarmonicCompliance.evaluate(thd, harmonics)
        puts json ? JSON.pretty_generate(result) : result.inspect
        return 0
      end

      if args.delete('--panel')
        amps = (args.shift || '100').to_i
        load = (args.shift || '0').to_f
        engine = TariffEngine.new(schedule('ca_sou_tou'))
        result = engine.panel_headroom(amps, 240, load)
        puts json ? JSON.pretty_generate(result) : result.inspect
        return 0
      end

      sched = schedule('ca_sou_tou')
      engine = TariffEngine.new(sched)
      shifts = {}
      if args.delete('--scenario') && args.shift == 'shift-ev'
        auto = engine.auto_shift(OFFLINE_APPLIANCE_MIRROR)
        shifts = auto[:shifts]
      end
      report = engine.arbitrage(OFFLINE_APPLIANCE_MIRROR, shifts)
      report[:tou_curve] = engine.tou_curve
      report[:panel_100a] = engine.panel_headroom(100, 240, OFFLINE_APPLIANCE_MIRROR.sum(&:kw))
      report[:panel_200a] = engine.panel_headroom(200, 240, OFFLINE_APPLIANCE_MIRROR.sum(&:kw))
      puts json ? JSON.pretty_generate(report) : report.inspect
      0
    end
  end
end

exit(VoltSpectra::CLI.run(ARGV)) if $PROGRAM_NAME == __FILE__
