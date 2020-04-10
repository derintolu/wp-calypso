/**
 * External dependencies
 */
import { connect } from 'react-redux';
import React, { Component } from 'react';
import momentDate from 'moment';
import page from 'page';
import { localize } from 'i18n-calypso';
import { includes } from 'lodash';

/**
 * Internal dependencies
 */
import { applySiteOffset } from 'lib/site/timezone';
import { backupMainPath } from './paths';
import { getSelectedSiteId } from 'state/ui/selectors';
import {
	isActivityBackup,
	getBackupAttemptsForDate,
	getDailyBackupDeltas,
	getEventsInDailyBackup,
	getMetaDiffForDailyBackup,
} from './utils';
import { requestActivityLogs } from 'state/data-getters';
import { updateFilter } from 'state/activity-log/actions';
import { withLocalizedMoment } from 'components/localized-moment';
import ActivityCard from '../../components/activity-card';
import ActivityCardList from 'landing/jetpack-cloud/components/activity-card-list';
import BackupDelta from '../../components/backup-delta';
import BackupUpsell from './components/upsell';
import DailyBackupStatus from '../../components/daily-backup-status';
import DatePicker from '../../components/date-picker';
import DocumentHead from 'components/data/document-head';
import getActivityLogFilter from 'state/selectors/get-activity-log-filter';
import getDoesRewindNeedCredentials from 'state/selectors/get-does-rewind-need-credentials.js';
import getIsRewindMissingPlan from 'state/selectors/get-is-rewind-missing-plan';
import getRewindCapabilities from 'state/selectors/get-rewind-capabilities';
import getRewindState from 'state/selectors/get-rewind-state';
import getSelectedSiteSlug from 'state/ui/selectors/get-selected-site-slug';
import getSiteGmtOffset from 'state/selectors/get-site-gmt-offset';
import getSiteTimezoneValue from 'state/selectors/get-site-timezone-value';
import Main from 'components/main';
import MissingCredentialsWarning from '../../components/missing-credentials';
import QueryRewindCapabilities from 'components/data/query-rewind-capabilities';
import QueryRewindState from 'components/data/query-rewind-state';
import QuerySitePurchases from 'components/data/query-site-purchases';
import QuerySiteSettings from 'components/data/query-site-settings'; // Required to get site time offset
import SidebarNavigation from 'my-sites/sidebar-navigation';

/**
 * Style dependencies
 */
import './style.scss';

const INDEX_FORMAT = 'YYYYMMDD';

const backupStatusNames = [
	'rewind__backup_complete_full',
	'rewind__backup_complete_initial',
	'rewind__backup_error',
];

class BackupsPage extends Component {
	state = this.getDefaultState();

	getDefaultState() {
		return {
			selectedDate: null,
		};
	}

	componentDidMount() {
		const { queryDate, moment, timezone, gmtOffset } = this.props;

		if ( queryDate ) {
			const today = applySiteOffset( moment(), { timezone, gmtOffset } );

			const dateToSelect = moment( queryDate, INDEX_FORMAT );

			// If we don't have dateToSelect or it's greater than today, force null
			if ( ! dateToSelect.isValid() || dateToSelect > today ) {
				this.onDateChange( null );
			} else {
				this.onDateChange( dateToSelect );
			}
		}
	}

	componentDidUpdate( prevProps ) {
		if ( prevProps.siteId !== this.props.siteId ) {
			//If we switch the site, reset the current state to default
			this.resetState();
		}
	}

	resetState() {
		this.setState( this.getDefaultState() );
	}

	onDateChange = date => {
		const { siteSlug } = this.props;

		this.setState( { selectedDate: date } );

		if ( date && date.isValid() ) {
			page(
				backupMainPath( siteSlug, {
					date: date.format( INDEX_FORMAT ),
				} )
			);
		} else {
			page( backupMainPath( siteSlug ) );
		}
	};

	getSelectedDate() {
		const { timezone, gmtOffset, moment } = this.props;

		const today = applySiteOffset( moment(), {
			timezone: timezone,
			gmtOffset: gmtOffset,
		} );

		return this.state.selectedDate || today;
	}

	/**
	 *  Return an object with the last backup from the date and the rest of the activities
	 *
	 * @param date {Date} The current selected date
	 */
	getBackupLogsFor = date => {
		const { moment } = this.props;

		const index = moment( date ).format( INDEX_FORMAT );

		const backupsOnSelectedDate = {
			lastBackup: null,
			activities: [],
		};

		if ( index in this.props.indexedLog && this.props.indexedLog[ index ].length > 0 ) {
			this.props.indexedLog[ index ].forEach( log => {
				// Looking for the last backup on the date
				if (
					! backupsOnSelectedDate.lastBackup &&
					includes( backupStatusNames, log.activityName )
				) {
					backupsOnSelectedDate.lastBackup = log;
				} else {
					backupsOnSelectedDate.activities.push( log );
				}
			} );
		}

		return backupsOnSelectedDate;
	};

	isEmptyFilter = filter => {
		if ( ! filter ) {
			return true;
		}
		if ( filter.group || filter.on || filter.before || filter.after ) {
			return false;
		}
		if ( filter.page !== 1 ) {
			return false;
		}
		return true;
	};

	TO_REMOVE_getSelectedDateString = () => {
		const { moment } = this.props;
		const { selectedDate } = this.state;
		return moment.parseZone( selectedDate ).toISOString( true );
	};

	renderMain() {
		const { isRewindMissingPlan, siteId, siteSlug, translate } = this.props;

		return (
			<Main>
				<DocumentHead title={ translate( 'Backups' ) } />
				<SidebarNavigation />
				<QueryRewindState siteId={ siteId } />
				<QuerySitePurchases siteId={ siteId } />
				<QuerySiteSettings siteId={ siteId } />
				<QueryRewindCapabilities siteId={ siteId } />
				{ isRewindMissingPlan ? <BackupUpsell siteSlug={ siteSlug } /> : this.renderBackupPicker() }
			</Main>
		);
	}

	renderBackupPicker() {
		const {
			allowRestore,
			doesRewindNeedCredentials,
			siteCapabilities,
			logs,
			moment,
			siteId,
			siteSlug,
			isLoadingBackups,
			oldestDateAvailable,
			lastDateAvailable,
			timezone,
			gmtOffset,
		} = this.props;

		const backupsOnSelectedDate = this.getBackupLogsFor( this.getSelectedDate() );
		const selectedDateString = this.TO_REMOVE_getSelectedDateString();
		const today = applySiteOffset( moment(), { timezone, gmtOffset } );
		const backupAttempts = getBackupAttemptsForDate( logs, selectedDateString );
		const deltas = getDailyBackupDeltas( logs, selectedDateString );
		const realtimeEvents = getEventsInDailyBackup( logs, selectedDateString );
		const metaDiff = getMetaDiffForDailyBackup( logs, selectedDateString );
		const hasRealtimeBackups = includes( siteCapabilities, 'backup-realtime' );

		return (
			<>
				<DatePicker
					onDateChange={ this.onDateChange }
					selectedDate={ this.getSelectedDate() }
					siteId={ siteId }
					oldestDateAvailable={ oldestDateAvailable }
					today={ today }
					siteSlug={ siteSlug }
				/>

				{ isLoadingBackups && <div className="backups__is-loading" /> }

				{ ! isLoadingBackups && (
					<>
						<DailyBackupStatus
							allowRestore={ allowRestore }
							siteSlug={ siteSlug }
							backup={ backupsOnSelectedDate.lastBackup }
							lastDateAvailable={ lastDateAvailable }
							selectedDate={ this.getSelectedDate() }
							timezone={ timezone }
							gmtOffset={ gmtOffset }
							onDateChange={ this.onDateChange }
						/>
						{ doesRewindNeedCredentials && (
							<MissingCredentialsWarning settingsLink={ `/settings/${ siteSlug }` } />
						) }
						<BackupDelta
							{ ...{
								deltas,
								backupAttempts,
								hasRealtimeBackups,
								realtimeEvents,
								allowRestore,
								moment,
								siteSlug,
								metaDiff,
							} }
						/>
					</>
				) }
			</>
		);
	}

	renderBackupSearch() {
		const { logs, siteSlug, translate } = this.props;

		// Filter out anything that is not restorable
		const restorablePoints = logs.filter( event => !! event.activityIsRewindable );

		return (
			<div className="backups__search">
				<div className="backups__search-header">
					{ translate( 'Find a backup or restore point' ) }
				</div>
				<div className="backups__search-description">
					{ translate(
						'This is the complete event history for your site. Filter by date range and/ or activity type.'
					) }
				</div>
				<ActivityCardList logs={ restorablePoints } pageSize={ 10 } siteSlug={ siteSlug } />
			</div>
		);
	}

	render() {
		const { filter } = this.props;

		return (
			<div className="backups__page">
				{ ! this.isEmptyFilter( filter ) ? this.renderBackupSearch() : this.renderMain() }
			</div>
		);
	}
}

/**
 * Create an indexed log of backups based on the date of the backup and in the site time zone
 *
 * @param {Array} logs The activity logs retrieved from the store
 * @param {string} timezone The site time zone
 * @param {number} gmtOffset The site offset from the GMT
 */
const createIndexedLog = ( logs, timezone, gmtOffset ) => {
	const indexedLog = {};
	let oldestDateAvailable = applySiteOffset( momentDate(), {
		timezone,
		gmtOffset,
	} );
	let lastDateAvailable = null;

	if ( 'success' === logs.state ) {
		logs.data.forEach( log => {
			//Move the backup date to the site timezone
			const backupDate = applySiteOffset( momentDate( log.activityTs ), {
				timezone,
				gmtOffset,
			} );

			//Get the index for this backup, index format: YYYYMMDD
			const index = backupDate.format( INDEX_FORMAT );

			if ( ! ( index in indexedLog ) ) {
				//The first time we create the index for this date
				indexedLog[ index ] = [];
			}

			// Check for the oldest and the last backup dates
			if ( isActivityBackup( log ) ) {
				if ( backupDate < oldestDateAvailable ) {
					oldestDateAvailable = backupDate;
				}
				if ( backupDate > lastDateAvailable ) {
					lastDateAvailable = backupDate;
				}
			}

			indexedLog[ index ].push( log );
		} );
	}

	return {
		indexedLog,
		oldestDateAvailable,
		lastDateAvailable,
	};
};

const mapStateToProps = state => {
	const siteId = getSelectedSiteId( state );
	const filter = getActivityLogFilter( state, siteId );
	const logs = requestActivityLogs( siteId, filter );
	const gmtOffset = getSiteGmtOffset( state, siteId );
	const timezone = getSiteTimezoneValue( state, siteId );
	const rewind = getRewindState( state, siteId );
	const restoreStatus = rewind.rewind && rewind.rewind.status;
	const doesRewindNeedCredentials = getDoesRewindNeedCredentials( state, siteId );
	const siteCapabilities = getRewindCapabilities( state, siteId );

	const allowRestore =
		'active' === rewind.state && ! ( 'queued' === restoreStatus || 'running' === restoreStatus );

	const { indexedLog, oldestDateAvailable, lastDateAvailable } = createIndexedLog(
		logs,
		timezone,
		gmtOffset
	);

	const isLoadingBackups = ! ( logs.state === 'success' );

	return {
		allowRestore,
		doesRewindNeedCredentials,
		filter,
		gmtOffset,
		indexedLog,
		isLoadingBackups,
		isRewindMissingPlan: getIsRewindMissingPlan( state, siteId ),
		lastDateAvailable,
		logs: logs?.data ?? [],
		oldestDateAvailable,
		rewind,
		siteCapabilities,
		siteId,
		siteSlug: getSelectedSiteSlug( state ),
		timezone,
	};
};

const mapDispatchToProps = dispatch => ( {
	selectPage: ( siteId, pageNumber ) => dispatch( updateFilter( siteId, { page: pageNumber } ) ),
} );

export default connect(
	mapStateToProps,
	mapDispatchToProps
)( localize( withLocalizedMoment( BackupsPage ) ) );
